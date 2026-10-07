import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import { LlmService } from '../llm/llm.service.js';
import { containsSecret, isForbiddenKeyName } from '../common/security/secret-patterns.js';
import { EntitiesService } from './entities.service.js';
import { MemoryService } from './memory.service.js';
import { ProfileFactsService } from './profile-facts.service.js';
import type { CreateMemoryDto } from './dto/create-memory.dto.js';
import {
  MEMORY_KINDS,
  type EssentialFactCandidate,
  type MemoryCandidate,
  type MemoryKind,
  type MemorySource,
} from './memory.types.js';

const ENTITY_KIND_TYPES = new Set(['person', 'company']);

// Skip the LLM entirely for input that is obviously not worth remembering —
// this is the primary defense against "ne mémorise pas chaque phrase".
const TRIVIAL_PATTERN =
  /^(bonjour|salut|coucou|hello|hi|hey|bonsoir|merci|merci beaucoup|ok|d'accord|oui|non|parfait|très bien|super|cool|au revoir|à bientôt)\W*$/i;
const MIN_WORD_COUNT = 4;
const MAX_ESSENTIAL_CANDIDATES = 2;
// A document can describe far more durable facts than one conversation turn, and there is
// no per-message cadence limiting how often this runs (once per document, not per message).
const MAX_DOCUMENT_MEMORIES = 15;
// Budget in characters, not tokens, but close enough to keep the call's cost bounded — a
// document's first ~12k characters are extracted from, not the whole file for a huge one.
const DOCUMENT_TEXT_BUDGET = 12_000;

const DOCUMENT_EXTRACTION_SYSTEM_PROMPT =
  "Tu identifies les informations DURABLES et utiles à mémoriser dans un document que l'utilisateur " +
  'vient d\'ajouter, pour pouvoir répondre à ses questions plus tard SANS avoir à rouvrir le document. ' +
  'Réponds UNIQUEMENT avec un objet JSON de la forme {"memories": [...]}. Aucun texte hors de ce JSON.\n\n' +
  `"memories" (0 à ${MAX_DOCUMENT_MEMORIES} éléments) : faits durables — personnes, sociétés, dates, ` +
  'décisions, tarifs, coordonnées, procédures, préférences, projets. Forme : {"kind": "...", "content": ' +
  '"phrase autonome et factuelle, compréhensible sans relire le document", "scope": "personal|professional", ' +
  `"importance": 0-1, "confidence": 0-1}. "kind" doit être l'une de: ${MEMORY_KINDS.join(', ')}.\n\n` +
  '"scope" classe CE FAIT PRÉCIS par ce qu\'il dit, jamais par le classement du document dans son ensemble : ' +
  'un document professionnel peut contenir un fait personnel (famille, santé, voyage privé) et l\'inverse. ' +
  'Un fait sur la famille, la santé, un loisir ou un bien personnel est "personal" même dans un document ' +
  'professionnel ; un fait sur une société, un client, un tarif ou une procédure de travail est ' +
  '"professional" même dans un document personnel.\n\n' +
  "Ignore le texte générique, les instructions de mise en forme, et tout ce qui n'apporte rien à retenir. " +
  "Si le document signale lui-même qu'une information est ancienne, incertaine, une simple proposition ou à " +
  'vérifier, reflète cette réserve dans le contenu plutôt que de la présenter comme un fait acquis. ' +
  'Si rien ne mérite d\'être retenu, réponds {"memories":[]}.';

const EXTRACTION_SYSTEM_PROMPT =
  'Tu identifies les informations DURABLES et utiles à mémoriser dans un échange entre un ' +
  'utilisateur et son assistant. Réponds UNIQUEMENT avec un objet JSON de la forme ' +
  '{"memories": [...], "essentialFacts": [...]}. Aucun texte hors de ce JSON.\n\n' +
  '"memories" (0 à 3 éléments) : informations durables propres AU SUJET/CONTEXTE de cette ' +
  'conversation (scope actuel uniquement) — décisions, personnes/sociétés, projets, habitudes, ' +
  'procédures, événements, faits. Forme : {"kind": "...", "content": "...", "importance": 0-1, ' +
  `"confidence": 0-1}. "kind" doit être l'une de: ${MEMORY_KINDS.join(', ')}.\n\n` +
  '"essentialFacts" (0 à 2 éléments) : préférences DURABLES et TRANSVERSALES qui doivent ' +
  "s'appliquer à QUASIMENT TOUTE réponse future de l'assistant, quel que soit le sujet ou le " +
  'scope (personnel, professionnel, ou une simple salutation) — typiquement : comportement ' +
  'linguistique ("répondre dans la langue utilisée par l\'utilisateur", "toujours répondre en ' +
  'français"), forme d\'adresse, style de salutation, style de réponse général (longueur, ton). ' +
  'Forme : {"key": "identifiant_court_en_snake_case", "value": "description complète et autonome ' +
  'de la préférence", "confidence": 0-1}. Clés typiques : "language_behavior", "form_of_address", ' +
  '"greeting_style", "response_style" — mais toute clé courte et descriptive est acceptée si aucune ' +
  "de celles-ci ne convient.\n\n" +
  'RÈGLES DE DISTINCTION (important) :\n' +
  '- Une préférence DURABLE ("quand je parle français, réponds-moi en français", "je préfère que ' +
  'tu sois concis", "appelle-moi toujours docteur") → à retenir (memories si scope-spécifique, ' +
  'essentialFacts si transversale comme la langue ou le style général).\n' +
  '- Une demande PONCTUELLE, valable pour ce seul message ("réponds-moi en anglais pour ce ' +
  'message", "sois bref cette fois") → NE JAMAIS la mémoriser, dans aucune des deux listes.\n' +
  '- Un fait DURABLE sur le sujet en cours ("mon entreprise s\'appelle LogistiGA") → memories, ' +
  'jamais essentialFacts (ce n\'est pas transversal).\n' +
  '- Une information CONTEXTUELLE temporaire ("je suis dans un taxi maintenant") → à ignorer ' +
  'complètement.\n' +
  '- Ignore les salutations, remerciements, confirmations triviales, demandes ponctuelles sans ' +
  "intérêt futur.\n\n" +
  'Exemple : utilisateur dit "quand je te parle en arabe, réponds en arabe, et en français si je te ' +
  'parle en français" → ' +
  '{"memories":[],"essentialFacts":[{"key":"language_behavior","value":"Répond systématiquement ' +
  "dans la langue utilisée par l'utilisateur dans son dernier message (arabe, français, ou toute " +
  'autre langue), plutôt que dans une langue fixe","confidence":0.9}]}.\n' +
  'Si rien ne mérite d\'être retenu, réponds {"memories":[],"essentialFacts":[]}.';

@Injectable()
export class MemoryExtractionService {
  private readonly logger = new Logger(MemoryExtractionService.name);

  constructor(
    private readonly llmService: LlmService,
    private readonly memoryService: MemoryService,
    private readonly profileFactsService: ProfileFactsService,
    private readonly entitiesService: EntitiesService,
    private readonly prisma: PrismaService,
  ) {}

  isWorthConsidering(message: string): boolean {
    const trimmed = message.trim();
    if (!trimmed) return false;
    if (TRIVIAL_PATTERN.test(trimmed)) return false;
    const wordCount = trimmed.split(/\s+/).filter(Boolean).length;
    return wordCount >= MIN_WORD_COUNT;
  }

  async proposeCandidates(
    userMessage: string,
    assistantResponse: string,
    context: { userId: string; scope?: string; space?: string },
  ): Promise<{ memories: MemoryCandidate[]; essentialFacts: EssentialFactCandidate[] }> {
    if (!this.isWorthConsidering(userMessage)) {
      return { memories: [], essentialFacts: [] };
    }

    const response = await this.llmService.complete(
      {
        messages: [
          { role: 'system', content: EXTRACTION_SYSTEM_PROMPT },
          {
            role: 'user',
            content: `Utilisateur: ${userMessage}\nAssistant: ${assistantResponse}`,
          },
        ],
        temperature: 0,
        maxTokens: 500,
      },
      { userId: context.userId, scope: context.scope, space: context.space, route: 'memory-extraction' },
    );

    if (!response.configured) {
      // No LLM (env or DB) → no extraction. Documented limitation, never blocks the app.
      return { memories: [], essentialFacts: [] };
    }

    return this.parseCandidates(response.content);
  }

  /**
   * Same idea as `proposeCandidates`, but for a whole document instead of one
   * conversation turn: no triviality/word-count gate (a document is always
   * worth looking at), a much higher candidate cap, and a prompt written for
   * a standalone document rather than a dialogue exchange.
   */
  async proposeCandidatesFromDocument(
    text: string,
    context: { userId: string; scope: string; space: string; filename: string },
  ): Promise<MemoryCandidate[]> {
    const trimmed = text.trim();
    if (!trimmed) return [];

    const response = await this.llmService.complete(
      {
        messages: [
          { role: 'system', content: DOCUMENT_EXTRACTION_SYSTEM_PROMPT },
          { role: 'user', content: `Document : ${context.filename}\n\n${trimmed.slice(0, DOCUMENT_TEXT_BUDGET)}` },
        ],
        temperature: 0,
        maxTokens: 1800,
      },
      { userId: context.userId, scope: context.scope, space: context.space, route: 'memory-extraction-document' },
    );

    if (!response.configured) {
      return [];
    }

    try {
      const parsed = JSON.parse(stripCodeFence(response.content)) as unknown;
      const obj = typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {};
      return (Array.isArray(obj.memories) ? obj.memories : [])
        .filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null)
        .map((item) => this.coerceMemoryCandidate(item))
        .filter((c): c is MemoryCandidate => c !== null)
        .filter((c) => !containsSecret(c.content))
        .slice(0, MAX_DOCUMENT_MEMORIES);
    } catch (error) {
      this.logger.warn(`Document memory extraction returned unparsable output: ${String(error)}`);
      return [];
    }
  }

  private parseCandidates(raw: string): { memories: MemoryCandidate[]; essentialFacts: EssentialFactCandidate[] } {
    try {
      const parsed = JSON.parse(stripCodeFence(raw)) as unknown;
      const obj = typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {};

      const memories = (Array.isArray(obj.memories) ? obj.memories : [])
        .filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null)
        .map((item) => this.coerceMemoryCandidate(item))
        .filter((c): c is MemoryCandidate => c !== null)
        .filter((c) => !containsSecret(c.content))
        .slice(0, 3);

      const essentialFacts = (Array.isArray(obj.essentialFacts) ? obj.essentialFacts : [])
        .filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null)
        .map((item) => this.coerceEssentialCandidate(item))
        .filter((c): c is EssentialFactCandidate => c !== null)
        .filter((c) => !isForbiddenKeyName(c.key) && !containsSecret(c.value))
        .slice(0, MAX_ESSENTIAL_CANDIDATES);

      return { memories, essentialFacts };
    } catch (error) {
      this.logger.warn(`Memory extraction returned unparsable output: ${String(error)}`);
      return { memories: [], essentialFacts: [] };
    }
  }

  private coerceMemoryCandidate(item: Record<string, unknown>): MemoryCandidate | null {
    const kind = MEMORY_KINDS.includes(item.kind as MemoryKind) ? (item.kind as MemoryKind) : null;
    const content = typeof item.content === 'string' ? item.content.trim() : '';
    if (!kind || !content) return null;

    // Only meaningful for a document/e-mail extraction (see proposeCandidatesFromDocument):
    // the model classifies each fact by what it actually says, not by whatever scope the
    // document happened to be filed under — a personal fact filed as "professional" (or the
    // reverse) must still end up where the user will actually look for it.
    const scope = item.scope === 'personal' || item.scope === 'professional' ? item.scope : undefined;

    return {
      kind,
      content,
      importance: clamp01(typeof item.importance === 'number' ? item.importance : 0.5),
      confidence: clamp01(typeof item.confidence === 'number' ? item.confidence : 0.5),
      scope,
    };
  }

  private coerceEssentialCandidate(item: Record<string, unknown>): EssentialFactCandidate | null {
    const key = typeof item.key === 'string' ? normalizeKey(item.key) : '';
    const value = typeof item.value === 'string' ? item.value.trim() : '';
    if (!key || !value) return null;

    return {
      key,
      value,
      confidence: clamp01(typeof item.confidence === 'number' ? item.confidence : 0.5),
    };
  }

  /**
   * Persists candidates as memories. A candidate that closely matches an
   * existing active memory (same kind/scope/space, high word overlap)
   * supersedes it instead of creating a duplicate — this is the
   * contradiction/"old info" handling required by the brief.
   */
  async commitCandidates(params: {
    userId: string;
    scope: 'personal' | 'professional';
    space: string;
    sourceMessageId: string;
    candidates: MemoryCandidate[];
    source?: MemorySource;
  }): Promise<void> {
    const source = params.source ?? 'extraction';
    for (const candidate of params.candidates) {
      // The fact's own scope wins over the batch's (e.g. a document filed as "professional"
      // can still contain a personal fact). "personal" only ever has the "personal" space;
      // a scope flip into "professional" without more information falls back to "general"
      // rather than keeping a personal-only space value like "personal" or "code".
      const scope = candidate.scope ?? params.scope;
      const space = scope === 'personal' ? 'personal' : scope === params.scope ? params.space : 'general';

      const dto: CreateMemoryDto = {
        scope,
        space,
        kind: candidate.kind,
        content: candidate.content,
        importance: candidate.importance,
        confidence: candidate.confidence,
      };

      const existing = await this.memoryService.findSupersessionCandidate(
        params.userId,
        scope,
        space,
        candidate.kind,
        candidate.content,
      );

      let memoryId: string;
      if (existing) {
        const { replacement } = await this.memoryService.supersede(
          params.userId,
          existing.id,
          dto,
          source,
          params.sourceMessageId,
        );
        memoryId = replacement.id;
      } else {
        const created = await this.memoryService.create(
          params.userId,
          dto,
          source,
          params.sourceMessageId,
        );
        memoryId = created.id;
      }

      if (ENTITY_KIND_TYPES.has(candidate.kind)) {
        await this.linkEntity(params.userId, scope, space, candidate, memoryId);
      }
    }
  }

  /**
   * Persists candidates as Essential Profile facts (ProfileFactsService,
   * scope='essential') — matched and superseded by `key`, not content
   * similarity, since these are structured preferences (AGENTS learning-
   * core §7 correction/supersession).
   */
  async commitEssentialFacts(params: {
    userId: string;
    sourceMessageId: string;
    candidates: EssentialFactCandidate[];
  }): Promise<void> {
    for (const candidate of params.candidates) {
      await this.profileFactsService.upsertEssential(params.userId, {
        key: candidate.key,
        value: candidate.value,
        confidence: candidate.confidence,
        source: 'extraction',
        sourceId: params.sourceMessageId,
      });
    }
  }

  /** Best-effort: a person/company memory also gets a deduped Entity row + link. */
  private async linkEntity(
    userId: string,
    scope: string,
    space: string,
    candidate: MemoryCandidate,
    memoryId: string,
  ): Promise<void> {
    const name = candidate.content.slice(0, 200).trim();
    if (!name) return;

    const entity = await this.entitiesService.findOrCreate({
      userId,
      scope,
      space,
      type: candidate.kind,
      name,
    });

    await this.prisma.memoryEntity.upsert({
      where: { memoryId_entityId: { memoryId, entityId: entity.id } },
      create: { memoryId, entityId: entity.id, role: 'subject' },
      update: {},
    });
  }
}

/** Some models wrap their JSON answer in a ```json fence despite being told not to; strip it before parsing. */
function stripCodeFence(raw: string): string {
  return raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/```$/, '').trim();
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function normalizeKey(key: string): string {
  return key
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_]/g, '')
    .slice(0, 60);
}
