import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import { LlmService } from '../llm/llm.service.js';
import { EntitiesService } from './entities.service.js';
import { MemoryService } from './memory.service.js';
import type { CreateMemoryDto } from './dto/create-memory.dto.js';
import { MEMORY_KINDS, type MemoryCandidate, type MemoryKind } from './memory.types.js';

const ENTITY_KIND_TYPES = new Set(['person', 'company']);

// Skip the LLM entirely for input that is obviously not worth remembering —
// this is the primary defense against "ne mémorise pas chaque phrase".
const TRIVIAL_PATTERN =
  /^(bonjour|salut|coucou|hello|hi|hey|bonsoir|merci|merci beaucoup|ok|d'accord|oui|non|parfait|très bien|super|cool|au revoir|à bientôt)\W*$/i;
const MIN_WORD_COUNT = 4;

const EXTRACTION_SYSTEM_PROMPT =
  'Tu identifies les informations DURABLES et utiles à mémoriser dans un échange entre un ' +
  "utilisateur et son assistant. Réponds UNIQUEMENT avec un tableau JSON (0 à 3 éléments), " +
  'chaque élément ayant la forme {"kind": "...", "content": "...", "importance": 0-1, "confidence": 0-1}. ' +
  `"kind" doit être l'une de: ${MEMORY_KINDS.join(', ')}. ` +
  "Ignore les salutations, remerciements, confirmations triviales, demandes ponctuelles sans intérêt futur. " +
  'Ne mémorise que: préférences durables, décisions, personnes/sociétés importantes, projets, habitudes, ' +
  'procédures, événements marquants, faits durables. Si rien ne mérite d\'être retenu, réponds "[]".';

@Injectable()
export class MemoryExtractionService {
  private readonly logger = new Logger(MemoryExtractionService.name);

  constructor(
    private readonly llmService: LlmService,
    private readonly memoryService: MemoryService,
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

  async proposeCandidates(userMessage: string, assistantResponse: string): Promise<MemoryCandidate[]> {
    if (!this.isWorthConsidering(userMessage)) {
      return [];
    }
    if (!this.llmService.isConfigured()) {
      // No LLM → no extraction. Documented limitation, never blocks the app.
      return [];
    }

    const response = await this.llmService.complete({
      messages: [
        { role: 'system', content: EXTRACTION_SYSTEM_PROMPT },
        {
          role: 'user',
          content: `Utilisateur: ${userMessage}\nAssistant: ${assistantResponse}`,
        },
      ],
      temperature: 0,
      maxTokens: 400,
    });

    if (!response.configured) {
      return [];
    }

    return this.parseCandidates(response.content);
  }

  private parseCandidates(raw: string): MemoryCandidate[] {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) return [];

      return parsed
        .filter(
          (item): item is Record<string, unknown> => typeof item === 'object' && item !== null,
        )
        .map((item) => this.coerceCandidate(item))
        .filter((c): c is MemoryCandidate => c !== null)
        .slice(0, 3);
    } catch (error) {
      this.logger.warn(`Memory extraction returned unparsable output: ${String(error)}`);
      return [];
    }
  }

  private coerceCandidate(item: Record<string, unknown>): MemoryCandidate | null {
    const kind = MEMORY_KINDS.includes(item.kind as MemoryKind) ? (item.kind as MemoryKind) : null;
    const content = typeof item.content === 'string' ? item.content.trim() : '';
    if (!kind || !content) return null;

    return {
      kind,
      content,
      importance: clamp01(typeof item.importance === 'number' ? item.importance : 0.5),
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
  }): Promise<void> {
    for (const candidate of params.candidates) {
      const dto: CreateMemoryDto = {
        scope: params.scope,
        space: params.space,
        kind: candidate.kind,
        content: candidate.content,
        importance: candidate.importance,
        confidence: candidate.confidence,
      };

      const existing = await this.memoryService.findSupersessionCandidate(
        params.userId,
        params.scope,
        params.space,
        candidate.kind,
        candidate.content,
      );

      let memoryId: string;
      if (existing) {
        const { replacement } = await this.memoryService.supersede(
          params.userId,
          existing.id,
          dto,
          'extraction',
          params.sourceMessageId,
        );
        memoryId = replacement.id;
      } else {
        const created = await this.memoryService.create(
          params.userId,
          dto,
          'extraction',
          params.sourceMessageId,
        );
        memoryId = created.id;
      }

      if (ENTITY_KIND_TYPES.has(candidate.kind)) {
        await this.linkEntity(params.userId, params.scope, params.space, candidate, memoryId);
      }
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

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}
