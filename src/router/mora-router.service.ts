import { Injectable, Logger } from '@nestjs/common';
import { LlmService } from '../llm/llm.service.js';
import type {
  MoraComplexity,
  MoraSecurityLevel,
  ProfessionalSpace,
  RouterDecisionResult,
} from './router.types.js';

// --- Deterministic keyword rules -------------------------------------------------
// French-first, intentionally simple regexes. Extend these lists rather than
// reaching for the LLM fallback for new common phrasings.

const PERSONAL_PATTERN =
  /\b(personnel(le)?|priv[ée]e?|ma famille|mon mari|ma femme|mes enfants|mon fils|ma fille|mon anniversaire|rendez-vous perso|rdv perso|rappelle[- ]moi|mon agenda perso|mes vacances|ma sant[ée]|mon m[ée]decin|mon compte perso)\b/i;

const PROFESSIONAL_SPACE_PATTERNS: Array<{ space: ProfessionalSpace; pattern: RegExp }> = [
  { space: 'logistiga', pattern: /\blogistiga\b/i },
  { space: 'piston', pattern: /\bpiston\b/i },
  {
    space: 'code',
    pattern:
      /\b(code|bug|typescript|javascript|nestjs|d[ée]ploiement|deploy(?:ment)?|git(?:hub)?|repo(?:sitory)?|api|base de donn[ée]es|serveur|fonction|classe|refactor(?:ing)?)\b/i,
  },
];

const PROFESSIONAL_GENERAL_PATTERN =
  /\b(travail|entreprise|client|facture|devis|r[ée]union|projet|coll[èe]gue|patron|contrat|budget|rapport|professionnel(?:le)?s?|pro|bureau|boulot|business)\b/i;

const GREETING_PATTERN =
  /^(bonjour|salut|coucou|hello|hi|hey|bonsoir|merci|salam|salaam|marhba|marhaba|chokran|choukran|labas|inshallah|inchallah|ok|d'accord)\b/i;
// Arabic-script greetings/thanks (Standard Arabic and Darija use the same
// script). `\b` word boundaries don't work reliably on non-Latin scripts in a
// non-unicode-aware regex (JS's default \w is ASCII-only), so this is
// anchored to the start of the message instead, mirroring GREETING_PATTERN's
// own start-anchoring rather than relying on \b. Generic, common greeting
// vocabulary only — not tied to any specific user or conversation.
const GREETING_PATTERN_ARABIC_SCRIPT =
  /^\s*(السلام عليكم|وعليكم السلام|سلام|مرحبا|أهلا|اهلا|شكرا|صباح الخير|مساء الخير)/;
const isGreeting = (text: string): boolean =>
  GREETING_PATTERN.test(text) || GREETING_PATTERN_ARABIC_SCRIPT.test(text);
// A message must be this short (in words) for a leading greeting to route it
// "direct" on its own — otherwise the greeting is just an opener on a
// substantive message that deserves real routing (see GREETING_PATTERN use below).
const GREETING_MAX_WORDS = 6;
const FACTUAL_DIRECT_PATTERN = /\b(quelle heure|quel jour|quelle date)\b/i;

// A message referring to the user's own stored data can never be answered on
// the tool-less "direct" path — it needs an agent with the retrieval tools.
// Checked in classifyWithRules() BEFORE the greeting / short-message /
// default-fallback rules, so no path (with or without an LLM) can put it on
// "direct".
const USER_DATA_PATTERN =
  /\b(mes?|ma|mon)\s+(documents?|fichiers?|notes?|t[âa]ches?|rappels?|agenda|calendrier|rendez-vous|contacts?|mails?|emails?|e-mails?|messages?|conversations?|factures?|souvenirs?|m[ée]moires?)\b/i;
// Questions about what Mora knows/remembers about the user ("Qu'est-ce que tu
// sais sur moi ?", "Que sais-tu de moi ?", "Tu te souviens de ce que je t'ai
// dit ?") — only answerable from the user's stored memories.
const SELF_KNOWLEDGE_PATTERN =
  /(?:\btu\s+(?:sais|connais|as\s+retenu|as\s+m[ée]moris[ée]|te\s+souviens)|\b(?:sais|connais)[- ]tu|\bte\s+souviens[- ]tu)(?:\s+[^\s?.!]+){0,4}?\s+(?:(?:sur|de)\s+moi\b|me\s+concernant\b|[àa]\s+mon\s+sujet\b)|\bce\s+que\s+je\s+t['’]ai\s+(?:dit|confi[ée]|appris|racont[ée])\b/i;

const SENSITIVE_PATTERN =
  /\b(mot de passe|password|iban|carte bancaire|cvv|num[ée]ro de carte|secret|cl[ée] api|api key|credentials?|num[ée]ro de s[ée]curit[ée] sociale)\b/i;

const TASK_PATTERN =
  /^(fais|cr[ée]e|envoie|planifie|rappelle|ajoute|supprime|annule|g[ée]n[èe]re|calcule|liste|montre|affiche)\b/i;

// An explicit instruction teaching Mora a durable behaviour/communication
// preference ("rappelle-toi que...", "souviens-toi que...", "à partir de
// maintenant...", "je préfère que...", "remember that...", "from now on...")
// must never land on "direct": only the personal/professional agents have a
// write path (create_memory tool, background extraction) and are the ones
// that end up feeding MemoryExtractionService → the Essential User Profile.
// This is deliberately generic (phrasing patterns, not specific languages or
// content) — see MemoryExtractionService for the durable-vs-temporary
// judgment call, which stays with the LLM classifier, not this regex.
const LEARNING_INSTRUCTION_PATTERN =
  /\b(rappelle[- ]toi|souviens[- ]toi|retiens que|m[ée]morise|n['’]oublie pas que|[àa] partir de maintenant|d[ée]sormais|je pr[ée]f[èe]re que|remember that|from now on|i prefer that|تذكر|احتفظ ب|من الآن)\b/i;

@Injectable()
export class MoraRouterService {
  private readonly logger = new Logger(MoraRouterService.name);

  constructor(private readonly llmService: LlmService) {}

  /**
   * Splits a message classified as `hybrid` into its personal part and its
   * professional part, each in the user's own words. Returns null when no LLM
   * is configured, the output is unparsable, or either part is missing — the
   * caller then falls back to asking the user to split the message themselves.
   */
  async splitHybrid(text: string, userId?: string): Promise<{ personal: string; professional: string } | null> {
    const response = await this.llmService.complete(
      {
        messages: [
          {
            role: 'system',
            content:
              'The user message mixes a personal request and a professional request. Split it into two parts, ' +
              'keeping the user\'s wording as much as possible: "personal" holds only the personal part, ' +
              '"professional" holds only the professional part. Respond with ONLY a JSON object: ' +
              '{"personal":"string","professional":"string"}. Use an empty string for a part that is absent. No prose.',
          },
          { role: 'user', content: text },
        ],
        temperature: 0,
        maxTokens: 400,
      },
      { userId, route: 'router-hybrid-split' },
    );

    if (!response.configured) {
      return null;
    }

    try {
      const parsed = JSON.parse(response.content) as { personal?: unknown; professional?: unknown };
      const personal = typeof parsed.personal === 'string' ? parsed.personal.trim() : '';
      const professional = typeof parsed.professional === 'string' ? parsed.professional.trim() : '';
      if (!personal || !professional) return null;
      return { personal, professional };
    } catch (error) {
      this.logger.warn(`Hybrid split returned unparsable output: ${String(error)}`);
      return null;
    }
  }

  /**
   * `userId` is optional and, when given, lets the LLM fallback use that
   * user's own AiProvider (Phase C.5) instead of only the env-configured one
   * — see LlmService's selection order. `classifyWithLlm` itself checks
   * `response.configured` before using the result, so no LLM call is ever
   * made when nothing (env or DB) is actually configured for this user.
   */
  async classify(message: string, userId?: string): Promise<RouterDecisionResult> {
    const text = message.trim();
    const rulesResult = this.classifyWithRules(text);
    if (rulesResult) {
      return rulesResult;
    }

    // No confident deterministic rule matched — only reach for the LLM when
    // one is actually configured; otherwise use a safe, low-confidence default
    // that never guesses into personal/professional territory.
    const llmResult = await this.classifyWithLlm(text, userId);
    if (llmResult) {
      return llmResult;
    }

    return this.defaultFallback(text);
  }

  private classifyWithRules(text: string): RouterDecisionResult | null {
    if (!text) {
      return this.buildResult({
        route: 'direct',
        scope: 'direct',
        space: 'direct',
        intent: 'unknown',
        text,
        confidence: 0.5,
        method: 'rules',
      });
    }

    const personalMatch = PERSONAL_PATTERN.test(text);
    const professionalSpaceMatch = PROFESSIONAL_SPACE_PATTERNS.find((entry) =>
      entry.pattern.test(text),
    );
    const professionalGeneralMatch = PROFESSIONAL_GENERAL_PATTERN.test(text);
    const professionalMatch = Boolean(professionalSpaceMatch) || professionalGeneralMatch;
    const professionalSpace: ProfessionalSpace = professionalSpaceMatch?.space ?? 'general';

    if (personalMatch && professionalMatch) {
      return this.buildResult({
        route: 'hybrid',
        scope: 'hybrid',
        space: 'hybrid',
        intent: this.detectIntent(text),
        text,
        confidence: 0.7,
        method: 'rules',
      });
    }

    if (professionalMatch) {
      return this.buildResult({
        route: 'professional',
        scope: 'professional',
        space: professionalSpace,
        intent: this.detectIntent(text),
        text,
        confidence: professionalSpaceMatch ? 0.9 : 0.75,
        method: 'rules',
      });
    }

    if (personalMatch) {
      return this.buildResult({
        route: 'personal',
        scope: 'personal',
        space: 'personal',
        intent: this.detectIntent(text),
        text,
        confidence: 0.85,
        method: 'rules',
      });
    }

    if (USER_DATA_PATTERN.test(text) || SELF_KNOWLEDGE_PATTERN.test(text)) {
      return this.buildResult({
        route: 'personal',
        scope: 'personal',
        space: 'personal',
        intent: this.detectIntent(text),
        text,
        confidence: 0.7,
        method: 'rules',
      });
    }

    // An explicit "teach Mora a durable preference" instruction that matched
    // neither the personal nor the professional keyword rules above still
    // must never fall through to "direct" (no write path there) — default
    // it to 'personal', the closest fit for a meta-preference about how
    // Mora itself communicates. If it WAS also personal/professional-coded,
    // one of the earlier branches already returned with that scope, so this
    // never overrides an explicit professional-space teaching instruction.
    if (LEARNING_INSTRUCTION_PATTERN.test(text)) {
      return this.buildResult({
        route: 'personal',
        scope: 'personal',
        space: 'personal',
        intent: 'learn_preference',
        text,
        confidence: 0.8,
        method: 'rules',
      });
    }

    const wordCount = text.split(/\s+/).filter(Boolean).length;

    // GREETING_PATTERN only checks the START of the message ("Bonjour...")
    // with no length limit, so a substantive message that happens to open
    // with a greeting ("Bonjour, je préfère que tu me répondes de façon
    // concise...") would otherwise be entirely swallowed into "direct"
    // before its real content — personal/professional keywords, or the LLM
    // fallback — ever gets a chance. Gating on a short word count keeps
    // genuine small talk ("Bonjour", "Bonjour Mora") on the fast direct
    // path while letting longer messages fall through. Found via real
    // end-to-end validation (Phase C.6) with a live LLM configured.
    const isShortGreeting = isGreeting(text) && wordCount <= GREETING_MAX_WORDS;

    if (isShortGreeting || FACTUAL_DIRECT_PATTERN.test(text)) {
      return this.buildResult({
        route: 'direct',
        scope: 'direct',
        space: 'direct',
        intent: this.detectIntent(text),
        text,
        confidence: 0.9,
        method: 'rules',
      });
    }

    if (wordCount <= 3) {
      // Very short, no keyword signal at all (e.g. "ça va ?", "et toi") —
      // treat as direct rather than guessing a scope.
      return this.buildResult({
        route: 'direct',
        scope: 'direct',
        space: 'direct',
        intent: this.detectIntent(text),
        text,
        confidence: 0.6,
        method: 'rules',
      });
    }

    return null;
  }

  private async classifyWithLlm(text: string, userId?: string): Promise<RouterDecisionResult | null> {
    const response = await this.llmService.complete(
      {
        messages: [
          {
            role: 'system',
            content:
              'You classify a user message for a routing system. Respond with ONLY a JSON object: ' +
              '{"route":"personal|professional|hybrid|direct","space":"personal|general|logistiga|piston|code|hybrid|direct","intent":"string","confidence":0-1}. No prose. ' +
              'Use "direct" ONLY for small talk or general knowledge that needs no access to the ' +
              "user's own data. Any request mentioning the user's documents, files, tasks, " +
              'reminders, calendar, contacts, emails, WhatsApp messages or stored memories must be ' +
              '"personal" or "professional", never "direct". A message that explicitly teaches the ' +
              'assistant a durable behaviour or communication preference (e.g. "remember that...", ' +
              '"from now on...", "I prefer that...", in any language) must also be "personal" or ' +
              '"professional", never "direct" — only those routes can persist it.',
          },
          { role: 'user', content: text },
        ],
        temperature: 0,
        maxTokens: 150,
      },
      { userId, route: 'router-classification' },
    );

    if (!response.configured) {
      return null;
    }

    try {
      const parsed = JSON.parse(response.content) as {
        route?: string;
        space?: string;
        intent?: string;
        confidence?: number;
      };
      const route = this.coerceRoute(parsed.route);
      if (!route) return null;

      return this.buildResult({
        route,
        scope: route,
        space: (parsed.space as RouterDecisionResult['space']) ?? this.defaultSpaceFor(route),
        intent: parsed.intent ?? 'unknown',
        text,
        confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.6,
        method: 'llm-fallback',
      });
    } catch (error) {
      this.logger.warn(`LLM router fallback returned unparsable output: ${String(error)}`);
      return null;
    }
  }

  private defaultFallback(text: string): RouterDecisionResult {
    return this.buildResult({
      route: 'direct',
      scope: 'direct',
      space: 'direct',
      intent: 'unknown',
      text,
      confidence: 0.35,
      method: 'default-fallback',
    });
  }

  private buildResult(params: {
    route: RouterDecisionResult['route'];
    scope: RouterDecisionResult['scope'];
    space: RouterDecisionResult['space'];
    intent: string;
    text: string;
    confidence: number;
    method: RouterDecisionResult['method'];
  }): RouterDecisionResult {
    return {
      route: params.route,
      scope: params.scope,
      space: params.space,
      intent: params.intent,
      complexity: this.detectComplexity(params.text),
      securityLevel: this.detectSecurityLevel(params.text, params.route),
      confidence: params.confidence,
      method: params.method,
    };
  }

  private detectIntent(text: string): string {
    if (LEARNING_INSTRUCTION_PATTERN.test(text)) return 'learn_preference';
    if (isGreeting(text)) return 'greeting';
    if (TASK_PATTERN.test(text)) return 'task';
    if (text.trim().endsWith('?')) return 'question';
    return 'information';
  }

  private detectComplexity(text: string): MoraComplexity {
    const wordCount = text.split(/\s+/).filter(Boolean).length;
    const sentenceCount = text.split(/[.!?]+/).filter((s) => s.trim().length > 0).length;
    if (wordCount > 40 || sentenceCount > 3) return 'high';
    if (wordCount > 12 || sentenceCount > 1) return 'medium';
    return 'low';
  }

  private detectSecurityLevel(
    text: string,
    route: RouterDecisionResult['route'],
  ): MoraSecurityLevel {
    if (SENSITIVE_PATTERN.test(text)) return 'high';
    if (route === 'professional' || route === 'hybrid') return 'medium';
    return 'low';
  }

  private coerceRoute(value?: string): RouterDecisionResult['route'] | null {
    if (value === 'personal' || value === 'professional' || value === 'hybrid' || value === 'direct') {
      return value;
    }
    return null;
  }

  private defaultSpaceFor(route: RouterDecisionResult['route']): RouterDecisionResult['space'] {
    if (route === 'professional') return 'general';
    if (route === 'personal') return 'personal';
    if (route === 'hybrid') return 'hybrid';
    return 'direct';
  }
}
