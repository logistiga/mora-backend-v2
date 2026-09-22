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

  const service = new MoraOrchestratorService(
    routerService as never,
    personalAgent as never,
    professionalAgent as never,
    conversationsService as never,
    routerDecisionsService as never,
    auditService as never,
    memoryQueue as never,
    conversationSummaryService as never,
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
});
