import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ClockService } from '../common/time/clock.service.js';
import { TimeContextService } from '../common/time/time-context.service.js';
import type { LlmResponse } from '../llm/llm.service.js';
import type { AgentUser } from './agent.types.js';
import { PersonalAgentService } from './personal-agent.service.js';

function buildService(fixedNow = new Date('2026-09-23T09:00:00.000Z')) {
  const contextBuilder = {
    build: vi.fn(async (params: { systemPrompt: string }) => ({
      messages: [{ role: 'system' as const, content: params.systemPrompt }],
      memoriesUsed: [],
      retrievalMode: 'none' as const,
      retrievalDurationMs: 0,
      usedSummary: false,
    })),
  };
  const llmService = {
    complete: vi.fn(
      async (): Promise<LlmResponse> => ({ configured: true, content: 'ok', provider: 'openai', model: 'gpt-4o-mini' }),
    ),
  };
  const toolRegistry = { toLlmToolDefinitions: vi.fn(() => []) };
  const clock = new ClockService();
  clock.now = () => fixedNow;
  const timeContext = new TimeContextService(clock, { get: () => 'UTC' } as never);

  const service = new PersonalAgentService(
    llmService as never,
    contextBuilder as never,
    toolRegistry as never,
    timeContext,
  );
  return { service, contextBuilder, llmService, toolRegistry };
}

const user: AgentUser = { id: 'u1', email: 'a@b.com', displayName: 'A' };
const routerDecision = {
  route: 'personal' as const,
  scope: 'personal' as const,
  space: 'personal' as const,
  intent: 'task',
  complexity: 'low' as const,
  securityLevel: 'low' as const,
  confidence: 0.9,
  method: 'rules' as const,
};

describe('PersonalAgentService — time context & confirmation-contract regressions', () => {
  let ctx: ReturnType<typeof buildService>;

  beforeEach(() => {
    ctx = buildService();
  });

  it('injects a real, freshly-computed time reference (never hardcoded) into the system prompt', async () => {
    await ctx.service.handle({ user, message: 'x', conversationId: 'c1', routerDecision });

    const systemPrompt = ctx.contextBuilder.build.mock.calls[0][0].systemPrompt as string;
    expect(systemPrompt).toContain('2026-09-23T09:00:00.000Z');
  });

  it('two calls at different clock times produce two different time references', async () => {
    const later = buildService(new Date('2026-09-24T10:00:00.000Z'));

    await ctx.service.handle({ user, message: 'x', conversationId: 'c1', routerDecision });
    await later.service.handle({ user, message: 'x', conversationId: 'c1', routerDecision });

    const first = ctx.contextBuilder.build.mock.calls[0][0].systemPrompt as string;
    const second = later.contextBuilder.build.mock.calls[0][0].systemPrompt as string;
    expect(first).not.toBe(second);
  });

  it('the system prompt forbids the LLM from simulating a confirmation without a real tool call', async () => {
    await ctx.service.handle({ user, message: 'x', conversationId: 'c1', routerDecision });

    const systemPrompt = ctx.contextBuilder.build.mock.calls[0][0].systemPrompt as string;
    expect(systemPrompt).toMatch(/jamais.*confirmation/i);
    expect(systemPrompt).toMatch(/tool call/i);
  });

  it('propagates toolCalls from the LLM response untouched (orchestrator decides what happens next)', async () => {
    ctx.llmService.complete.mockResolvedValue({
      configured: true,
      content: '',
      provider: 'openai',
      model: 'gpt-4o-mini',
      toolCalls: [{ name: 'create_task', arguments: { title: 'x' }, providerCallId: 'call_1' }],
    });

    const result = await ctx.service.handle({ user, message: 'x', conversationId: 'c1', routerDecision });
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls?.[0].name).toBe('create_task');
  });

  it('a plain-text response with no toolCalls never fabricates one (agent never invents a tool call)', async () => {
    ctx.llmService.complete.mockResolvedValue({
      configured: true,
      content: 'Créer une tâche : "X". Veux-tu confirmer ?', // model narrating without a real tool call
      provider: 'openai',
      model: 'gpt-4o-mini',
    });

    const result = await ctx.service.handle({ user, message: 'x', conversationId: 'c1', routerDecision });
    expect(result.toolCalls).toBeUndefined();
  });

  it('adds an explicit voice interruption instruction so a topic change is answered directly', async () => {
    await ctx.service.handle({
      user,
      message: 'Parle-moi de PostgreSQL',
      conversationId: 'c1',
      routerDecision,
      channel: 'voice',
      recentInterruption: true,
    });

    const systemPrompt = ctx.contextBuilder.build.mock.calls[0][0].systemPrompt as string;
    expect(systemPrompt).toMatch(/interrompre Mora/i);
    expect(systemPrompt).toMatch(/réponds directement/i);
    expect(systemPrompt).toMatch(/ne reprends pas/i);
  });
});
