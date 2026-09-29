import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LlmService } from '../llm/llm.service.js';
import { MoraRouterService } from './mora-router.service.js';

describe('MoraRouterService', () => {
  let llmServiceMock: { isConfigured: ReturnType<typeof vi.fn>; complete: ReturnType<typeof vi.fn> };
  let service: MoraRouterService;

  beforeEach(() => {
    llmServiceMock = {
      isConfigured: vi.fn(() => false),
      complete: vi.fn(async () => ({ configured: false, content: '', provider: 'none', model: null })),
    };
    service = new MoraRouterService(llmServiceMock as unknown as LlmService);
  });

  it('classifies a greeting as direct', async () => {
    const result = await service.classify('Bonjour Mora');
    expect(result.route).toBe('direct');
    expect(result.scope).toBe('direct');
    expect(result.space).toBe('direct');
    expect(result.intent).toBe('greeting');
    expect(result.method).toBe('rules');
    expect(result.confidence).toBeGreaterThan(0.5);
  });

  it('does not swallow a substantive message into "direct" just because it opens with a greeting (regression, Phase C.6)', async () => {
    // Found via real end-to-end validation: this exact phrasing was
    // previously misrouted to "direct" (canned reply) purely because it
    // starts with "Bonjour", even though it carries a real personal
    // preference.
    //
    // Learning-core phase update: this exact phrasing ("je préfère que...")
    // is now caught deterministically by LEARNING_INSTRUCTION_PATTERN and
    // routed 'personal' with high confidence, WITHOUT needing an LLM —
    // superseding the old "land on the safe low-confidence default, hope
    // the LLM fallback saves it" behaviour with a real fix: a durable
    // preference instruction should never depend on an LLM being configured
    // to be routed somewhere it can actually be learned. See
    // MoraRouterService and the dedicated LLM-fallback test below for the
    // (still-covered) case of a preference phrased in a way no rule catches.
    const result = await service.classify(
      'Bonjour Mora. Je préfère que tu me répondes de façon concise, naturelle et directe.',
    );
    expect(result.route).toBe('personal');
    expect(result.method).toBe('rules');
    expect(result.intent).toBe('learn_preference');
    expect(result.confidence).toBeGreaterThan(0.5);
  });

  it('lets a short greeting-only message still route as direct/greeting', async () => {
    const short = await service.classify('Bonjour Mora, merci beaucoup !');
    expect(short.route).toBe('direct');
    expect(short.intent).toBe('greeting');
    expect(short.method).toBe('rules');
  });

  it('never leaves a request about the user own documents on the tool-less direct route (regression, stabilization K)', async () => {
    llmServiceMock.complete.mockResolvedValue({
      configured: true,
      content: JSON.stringify({
        route: 'direct',
        space: 'direct',
        intent: 'chercher une note',
        confidence: 0.85,
      }),
      provider: 'openai',
      model: 'gpt-4o-mini',
    });

    const result = await service.classify(
      'Cherche dans mes documents ce que dit la note interne sur Atlas Logistique',
    );
    expect(result.route).toBe('personal');
    expect(result.scope).toBe('personal');
  });

  it('lets the LLM fallback classify a substantive greeting-opened message once no rule matches', async () => {
    llmServiceMock.complete.mockResolvedValue({
      configured: true,
      content: JSON.stringify({
        route: 'personal',
        space: 'personal',
        intent: 'preference',
        confidence: 0.8,
      }),
      provider: 'openai',
      model: 'gpt-4o-mini',
    });

    // Deliberately NOT the "je préfère que..." phrasing used elsewhere in
    // this file: that one is now caught deterministically by
    // LEARNING_INSTRUCTION_PATTERN (see the regression test above) and would
    // never reach this fallback. This message is substantive, opens with a
    // greeting, and matches no rule at all — genuinely exercising the LLM
    // fallback path.
    const result = await service.classify(
      "Bonjour Mora. Peux-tu m'expliquer en détail comment fonctionne la photosynthèse ?",
    );

    expect(result.method).toBe('llm-fallback');
    expect(result.route).toBe('personal');
  });

  it('classifies a personal message as personal', async () => {
    const result = await service.classify("Rappelle-moi le rendez-vous de ma fille demain");
    expect(result.route).toBe('personal');
    expect(result.scope).toBe('personal');
    expect(result.space).toBe('personal');
  });

  it('classifies a Logistiga message as professional/logistiga', async () => {
    const result = await service.classify('Vérifie le statut de la commande Logistiga');
    expect(result.route).toBe('professional');
    expect(result.space).toBe('logistiga');
  });

  it('classifies a Piston message as professional/piston', async () => {
    const result = await service.classify('Le budget du projet Piston doit être révisé');
    expect(result.route).toBe('professional');
    expect(result.space).toBe('piston');
  });

  it('classifies a coding message as professional/code', async () => {
    const result = await service.classify('Il y a un bug dans le code TypeScript de l\'API');
    expect(result.route).toBe('professional');
    expect(result.space).toBe('code');
  });

  it('classifies a generic work message as professional/general', async () => {
    const result = await service.classify('Il faut préparer la facture pour le client');
    expect(result.route).toBe('professional');
    expect(result.space).toBe('general');
  });

  it('classifies a message mixing personal and professional as hybrid', async () => {
    const result = await service.classify(
      "Rappelle-moi mon rendez-vous perso et vérifie aussi le client Logistiga",
    );
    expect(result.route).toBe('hybrid');
    expect(result.scope).toBe('hybrid');
  });

  it('flags sensitive content with a high security level regardless of route', async () => {
    const result = await service.classify('Quel est mon mot de passe pour Logistiga ?');
    expect(result.securityLevel).toBe('high');
  });

  it('falls back to a low-confidence direct default when the LLM (env or DB) is not configured and no rule matches', async () => {
    // complete() IS attempted (Phase C.5: whether an LLM is available now
    // depends on the calling user's own DB providers too, not just env, so
    // the router can no longer pre-check with a synchronous isConfigured())
    // but LlmService itself reports back "not configured" — never a network call.
    const ambiguous =
      'Considérant la situation actuelle et les circonstances environnantes qui évoluent';
    const result = await service.classify(ambiguous);
    expect(result.method).toBe('default-fallback');
    expect(result.route).toBe('direct');
    expect(result.confidence).toBeLessThan(0.5);
    expect(llmServiceMock.complete).toHaveBeenCalledOnce();
  });

  it('uses the LLM fallback when it reports back configured, with no rule matched', async () => {
    llmServiceMock.complete.mockResolvedValue({
      configured: true,
      content: JSON.stringify({
        route: 'professional',
        space: 'general',
        intent: 'task',
        confidence: 0.66,
      }),
      provider: 'openai-compatible',
      model: 'gpt-4o-mini',
    });

    const ambiguous =
      'Considérant la situation actuelle et les circonstances environnantes qui évoluent';
    const result = await service.classify(ambiguous);

    expect(llmServiceMock.complete).toHaveBeenCalledOnce();
    expect(result.method).toBe('llm-fallback');
    expect(result.route).toBe('professional');
    expect(result.confidence).toBe(0.66);
  });

  it('does not call the LLM for a simple deterministic message', async () => {
    await service.classify('Bonjour');
    expect(llmServiceMock.complete).not.toHaveBeenCalled();
  });
  describe('user-data questions never land on the tool-less direct route', () => {
    it.each([
      "Qu'est-ce que tu sais sur moi ?",
      'Que sais-tu de moi ?',
      'Tu te souviens de moi ?',
      'Te souviens-tu de ce que je t’ai dit hier ?',
      'Tu sais quoi à mon sujet ?',
      "Qu'est-ce que tu as retenu sur moi ?",
      'Mes rappels ?',
      'Liste mes tâches',
      'Bonjour, montre mes notes',
      'Peux-tu retrouver ce que disent mes documents importants stp',
    ])('routes "%s" to personal by rules, without any LLM (regression, smoke fbd9317)', async (text) => {
      const result = await service.classify(text);
      expect(result.route).toBe('personal');
      expect(result.scope).toBe('personal');
      expect(result.method).toBe('rules');
      expect(llmServiceMock.complete).not.toHaveBeenCalled();
    });

    it('keeps a user-data question off direct even when an LLM would have said direct', async () => {
      llmServiceMock.complete.mockResolvedValue({
        configured: true,
        content: JSON.stringify({ route: 'direct', space: 'direct', intent: 'question', confidence: 0.9 }),
        provider: 'openai',
        model: 'gpt-4o-mini',
      });
      const result = await service.classify("Qu'est-ce que tu sais sur moi ?");
      expect(result.route).toBe('personal');
    });

    it.each([
      'Que sais-tu sur la France ?',
      'Tu connais la capitale du Maroc ?',
      'Bonjour Mora',
      'ça va ?',
    ])('leaves a general question "%s" alone', async (text) => {
      const result = await service.classify(text);
      expect(result.route).toBe('direct');
    });
  });

  describe('Arabic-script greeting recognition (language-selection-policy fix)', () => {
    // Regression: a real voice test showed "السلام عليكم" behaved
    // inconsistently mid-conversation compared to the Latin-script "Salam",
    // which already worked reliably. Root cause: GREETING_PATTERN only
    // matched Latin script, so an Arabic-script greeting's `intent` never
    // became 'greeting' — the one thing that lets applyConversationContinuity
    // (MoraOrchestratorService) keep a mid-conversation greeting on the
    // "direct" route instead of rerouting it into an already-active
    // personal/professional scope.
    it.each(['السلام عليكم', 'وعليكم السلام', 'سلام', 'مرحبا', 'أهلا', 'شكرا', 'صباح الخير', 'مساء الخير'])(
      'classifies the Arabic-script greeting/thanks "%s" as direct with intent=greeting',
      async (text) => {
        const result = await service.classify(text);
        expect(result.route).toBe('direct');
        expect(result.intent).toBe('greeting');
      },
    );

    it('still classifies a longer Arabic-script message (not just a greeting) normally, not as a forced greeting', async () => {
      const result = await service.classify(
        'مرحبا، هل يمكنك أن تشرح لي كيف يعمل النظام الشمسي بالتفصيل من فضلك؟',
      );
      expect(result.intent).not.toBe('greeting');
    });
  });
});
