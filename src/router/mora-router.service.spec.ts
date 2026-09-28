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
    // preference — no LLM configured here, so it should land on the safe
    // low-confidence default fallback, never the confident "greeting" path.
    const result = await service.classify(
      'Bonjour Mora. Je préfère que tu me répondes de façon concise, naturelle et directe.',
    );
    expect(result.method).not.toBe('rules');
    expect(result.confidence).toBeLessThan(0.5);
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

    const result = await service.classify(
      'Bonjour Mora. Je préfère que tu me répondes de façon concise, naturelle et directe.',
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
  describe('explicit "personnel" wording wins over business keywords (regression, stabilization K)', () => {
    it('routes "mes documents personnels ... contrat" to personal, not professional', async () => {
      const result = await service.classify(
        'Dans mes documents personnels, qui est mon transporteur de secours et quand expire le contrat ?',
      );
      expect(result.route).toBe('personal');
      expect(result.scope).toBe('personal');
      expect(result.space).toBe('personal');
    });

    it('overrides an LLM "professional" classification when the user said "personnelle"', async () => {
      llmServiceMock.complete.mockResolvedValue({
        configured: true,
        content: JSON.stringify({
          route: 'professional',
          space: 'general',
          intent: 'question',
          confidence: 0.9,
        }),
        provider: 'openai',
        model: 'gpt-4o-mini',
      });
      const result = await service.classify(
        'Quelle est la date inscrite sur ma fiche personnelle de suivi transporteur ?',
      );
      expect(result.route).toBe('personal');
      expect(result.space).toBe('personal');
    });

    it('still routes a plain business question to professional', async () => {
      const result = await service.classify('Il faut préparer la facture pour le client');
      expect(result.route).toBe('professional');
    });
  });
});
