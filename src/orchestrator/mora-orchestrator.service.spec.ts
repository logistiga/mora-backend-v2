import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentUser } from '../agents/agent.types.js';
import { MoraOrchestratorService } from './mora-orchestrator.service.js';

function buildService(overrides: { crossScopeEnabled?: boolean } = {}) {
  const routerService = { classify: vi.fn() };
  const personalAgent = { handle: vi.fn() };
  const professionalAgent = { handle: vi.fn() };
  const conversationsService = {
    getOrCreateConversation: vi.fn(async () => ({ id: 'conv-1' })),
    addMessage: vi.fn(async ({ role }: { role: string }) => ({
      id: role === 'USER' ? 'user-msg-1' : 'assistant-msg-1',
    })),
    getScopedHistory: vi.fn(async () => []),
  };
  const routerDecisionsService = { save: vi.fn() };
  const auditService = { log: vi.fn() };
  const memoryQueue = { enqueueExtraction: vi.fn(), enqueueSummary: vi.fn(), enqueueEmbedding: vi.fn() };
  const conversationSummaryService = { shouldSummarize: vi.fn(async () => false) };
  const configService = {
    get: vi.fn(() => overrides.crossScopeEnabled ?? false),
  };
  const toolExecutor = { requestExecution: vi.fn() };
  const llmService = { complete: vi.fn(async () => ({ configured: false, content: '', provider: 'none', model: null })) };

  const service = new MoraOrchestratorService(
    routerService as never,
    personalAgent as never,
    professionalAgent as never,
    conversationsService as never,
    routerDecisionsService as never,
    auditService as never,
    memoryQueue as never,
    conversationSummaryService as never,
    toolExecutor as never,
    llmService as never,
    configService as never,
  );

  return {
    service,
    routerService,
    personalAgent,
    professionalAgent,
    conversationsService,
    routerDecisionsService,
    auditService,
    memoryQueue,
    conversationSummaryService,
    toolExecutor,
    llmService,
  };
}

/** Background jobs are fired via `void promise.catch(...)` — awaiting one tick lets them settle. */
async function flushMicrotasks(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

const user: AgentUser = { id: 'u1', email: 'a@b.com', displayName: 'A' };

describe('MoraOrchestratorService', () => {
  let ctx: ReturnType<typeof buildService>;

  beforeEach(() => {
    ctx = buildService();
  });

  it('answers "direct" without calling any agent', async () => {
    ctx.routerService.classify.mockResolvedValue({
      route: 'direct',
      scope: 'direct',
      space: 'direct',
      intent: 'greeting',
      complexity: 'low',
      securityLevel: 'low',
      confidence: 0.9,
      method: 'rules',
    });

    const result = await ctx.service.handleMessage({ user, message: 'Bonjour' });

    expect(ctx.personalAgent.handle).not.toHaveBeenCalled();
    expect(ctx.professionalAgent.handle).not.toHaveBeenCalled();
    expect(result.route).toBe('direct');
    expect(result.response).toMatch(/bonjour/i);
  });

  it('routes "personal" to PersonalAgentService with the conversation id', async () => {
    ctx.routerService.classify.mockResolvedValue({
      route: 'personal',
      scope: 'personal',
      space: 'personal',
      intent: 'task',
      complexity: 'low',
      securityLevel: 'low',
      confidence: 0.85,
      method: 'rules',
    });
    ctx.personalAgent.handle.mockResolvedValue({ content: 'ok perso', metadata: {} });

    const result = await ctx.service.handleMessage({ user, message: 'Rappelle-moi mon rdv' });

    expect(ctx.personalAgent.handle).toHaveBeenCalledOnce();
    expect(ctx.personalAgent.handle).toHaveBeenCalledWith(
      expect.objectContaining({ conversationId: 'conv-1' }),
    );
    expect(ctx.professionalAgent.handle).not.toHaveBeenCalled();
    expect(result.route).toBe('personal');
    expect(result.response).toBe('ok perso');
  });

  it('routes "professional" to ProfessionalAgentService with the conversation id', async () => {
    ctx.routerService.classify.mockResolvedValue({
      route: 'professional',
      scope: 'professional',
      space: 'logistiga',
      intent: 'question',
      complexity: 'low',
      securityLevel: 'medium',
      confidence: 0.9,
      method: 'rules',
    });
    ctx.professionalAgent.handle.mockResolvedValue({ content: 'ok pro', metadata: {} });

    const result = await ctx.service.handleMessage({ user, message: 'Statut Logistiga ?' });

    expect(ctx.professionalAgent.handle).toHaveBeenCalledOnce();
    expect(ctx.professionalAgent.handle).toHaveBeenCalledWith(
      expect.objectContaining({ conversationId: 'conv-1' }),
    );
    expect(ctx.personalAgent.handle).not.toHaveBeenCalled();
    expect(result.space).toBe('logistiga');
  });

  it('blocks "hybrid" by default (cross-scope disabled) without calling any agent', async () => {
    ctx.routerService.classify.mockResolvedValue({
      route: 'hybrid',
      scope: 'hybrid',
      space: 'hybrid',
      intent: 'task',
      complexity: 'medium',
      securityLevel: 'medium',
      confidence: 0.7,
      method: 'rules',
    });

    const result = await ctx.service.handleMessage({ user, message: 'perso + logistiga' });

    expect(ctx.personalAgent.handle).not.toHaveBeenCalled();
    expect(ctx.professionalAgent.handle).not.toHaveBeenCalled();
    expect(result.route).toBe('hybrid');
    expect(result.response).toMatch(/cross-scope est désactivé/i);
    expect(ctx.auditService.log).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: expect.objectContaining({ crossScopeBlocked: true }) }),
    );
  });

  it('persists the user message, the assistant message, and the router decision', async () => {
    ctx.routerService.classify.mockResolvedValue({
      route: 'direct',
      scope: 'direct',
      space: 'direct',
      intent: 'greeting',
      complexity: 'low',
      securityLevel: 'low',
      confidence: 0.9,
      method: 'rules',
    });

    await ctx.service.handleMessage({ user, message: 'Bonjour' });

    expect(ctx.conversationsService.addMessage).toHaveBeenCalledTimes(2);
    expect(ctx.routerDecisionsService.save).toHaveBeenCalledWith(
      'conv-1',
      'user-msg-1',
      expect.objectContaining({ route: 'direct' }),
    );
    expect(ctx.auditService.log).toHaveBeenCalledOnce();
  });

  it('schedules a memory-extraction job for personal/professional but not for direct', async () => {
    ctx.routerService.classify.mockResolvedValue({
      route: 'personal',
      scope: 'personal',
      space: 'personal',
      intent: 'task',
      complexity: 'low',
      securityLevel: 'low',
      confidence: 0.85,
      method: 'rules',
    });
    ctx.personalAgent.handle.mockResolvedValue({ content: 'ok', metadata: {} });

    await ctx.service.handleMessage({ user, message: 'Rappelle-moi mon rdv' });
    await flushMicrotasks();

    expect(ctx.memoryQueue.enqueueExtraction).toHaveBeenCalledWith(
      expect.objectContaining({ scope: 'personal', space: 'personal' }),
    );
  });

  it('does not schedule a memory-extraction job for a direct reply', async () => {
    ctx.routerService.classify.mockResolvedValue({
      route: 'direct',
      scope: 'direct',
      space: 'direct',
      intent: 'greeting',
      complexity: 'low',
      securityLevel: 'low',
      confidence: 0.9,
      method: 'rules',
    });

    await ctx.service.handleMessage({ user, message: 'Bonjour' });
    await flushMicrotasks();

    expect(ctx.memoryQueue.enqueueExtraction).not.toHaveBeenCalled();
  });

  it('does not schedule a memory-extraction job for a blocked hybrid reply', async () => {
    ctx.routerService.classify.mockResolvedValue({
      route: 'hybrid',
      scope: 'hybrid',
      space: 'hybrid',
      intent: 'task',
      complexity: 'medium',
      securityLevel: 'medium',
      confidence: 0.7,
      method: 'rules',
    });

    await ctx.service.handleMessage({ user, message: 'perso + logistiga' });
    await flushMicrotasks();

    expect(ctx.memoryQueue.enqueueExtraction).not.toHaveBeenCalled();
  });

  describe('tool-calling confirmation contract (post-review correction)', () => {
    const personalDecision = {
      route: 'personal',
      scope: 'personal',
      space: 'personal',
      intent: 'task',
      complexity: 'low',
      securityLevel: 'low',
      confidence: 0.85,
      method: 'rules',
    };

    it('never fabricates an `action` when the agent returned no real toolCalls, even if the text mimics a confirmation', async () => {
      ctx.routerService.classify.mockResolvedValue(personalDecision);
      ctx.personalAgent.handle.mockResolvedValue({
        content: 'Créer une tâche : "X". Veux-tu confirmer ?', // LLM narrating without a real tool call
        metadata: {},
        // toolCalls intentionally absent — this is the exact case under review
      });

      const result = await ctx.service.handleMessage({ user, message: 'Ajoute une tâche X' });

      expect(result.action).toBeUndefined();
      expect(ctx.toolExecutor.requestExecution).not.toHaveBeenCalled();
    });

    it('`action` only ever comes from a real ToolExecutor pending_confirmation outcome, never from agent text', async () => {
      ctx.routerService.classify.mockResolvedValue(personalDecision);
      ctx.personalAgent.handle.mockResolvedValue({
        content: 'ignored — the backend template replaces this',
        metadata: {},
        toolCalls: [{ name: 'create_task', arguments: { title: 'X' }, providerCallId: 'call_1' }],
      });
      ctx.toolExecutor.requestExecution.mockResolvedValue({
        kind: 'pending_confirmation',
        pendingActionId: 'pa-1',
        summary: 'Créer une tâche : "X"',
        securityLevel: 'N2',
      });

      const result = await ctx.service.handleMessage({ user, message: 'Ajoute une tâche X' });

      expect(ctx.toolExecutor.requestExecution).toHaveBeenCalledWith(
        'create_task',
        { title: 'X' },
        expect.objectContaining({ scope: 'personal', space: 'personal' }),
      );
      expect(result.action).toEqual({
        type: 'confirmation_required',
        pendingActionId: 'pa-1',
        tool: 'create_task',
        securityLevel: 'N2',
        summary: 'Créer une tâche : "X"',
      });
    });

    it('a second real tool call in the SAME conversation produces a distinct pending_action, never a stale/reused one', async () => {
      ctx.routerService.classify.mockResolvedValue(personalDecision);
      ctx.toolExecutor.requestExecution
        .mockResolvedValueOnce({
          kind: 'pending_confirmation',
          pendingActionId: 'pa-1',
          summary: 'Créer une tâche : "Appeler Jean"',
          securityLevel: 'N2',
        })
        .mockResolvedValueOnce({
          kind: 'pending_confirmation',
          pendingActionId: 'pa-2',
          summary: 'Créer une tâche : "Préparer le dossier"',
          securityLevel: 'N2',
        });

      ctx.personalAgent.handle.mockResolvedValueOnce({
        content: '',
        metadata: {},
        toolCalls: [{ name: 'create_task', arguments: { title: 'Appeler Jean' }, providerCallId: 'call_1' }],
      });
      const first = await ctx.service.handleMessage({ user, conversationId: 'conv-1', message: 'Ajoute une tâche appeler Jean' });

      ctx.personalAgent.handle.mockResolvedValueOnce({
        content: '',
        metadata: {},
        toolCalls: [{ name: 'create_task', arguments: { title: 'Préparer le dossier' }, providerCallId: 'call_2' }],
      });
      const second = await ctx.service.handleMessage({ user, conversationId: 'conv-1', message: 'Ajoute aussi une tâche préparer le dossier' });

      expect(first.action?.pendingActionId).toBe('pa-1');
      expect(second.action?.pendingActionId).toBe('pa-2');
      expect(first.action?.pendingActionId).not.toBe(second.action?.pendingActionId);
      expect(ctx.toolExecutor.requestExecution).toHaveBeenCalledTimes(2);
    });

    it('a rejected/unknown tool call never produces an `action` field', async () => {
      ctx.routerService.classify.mockResolvedValue(personalDecision);
      ctx.personalAgent.handle.mockResolvedValue({
        content: '',
        metadata: {},
        toolCalls: [{ name: 'delete_everything', arguments: {}, providerCallId: 'call_1' }],
      });
      ctx.toolExecutor.requestExecution.mockResolvedValue({ kind: 'rejected', reason: 'unknown_tool' });

      const result = await ctx.service.handleMessage({ user, message: 'fais un truc dangereux' });
      expect(result.action).toBeUndefined();
    });
  });
});
