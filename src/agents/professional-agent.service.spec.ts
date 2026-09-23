import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ClockService } from '../common/time/clock.service.js';
import { TimeContextService } from '../common/time/time-context.service.js';
import type { AgentUser } from './agent.types.js';
import { ProfessionalAgentService } from './professional-agent.service.js';

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
    complete: vi.fn(async () => ({ configured: true, content: 'ok', provider: 'openai', model: 'gpt-4o-mini' })),
  };
  const toolRegistry = { toLlmToolDefinitions: vi.fn(() => []) };
  const clock = new ClockService();
  clock.now = () => fixedNow;
  const timeContext = new TimeContextService(clock, { get: () => 'UTC' } as never);

  const service = new ProfessionalAgentService(
    llmService as never,
    contextBuilder as never,
    toolRegistry as never,
    timeContext,
  );
  return { service, contextBuilder, llmService, toolRegistry };
}

const user: AgentUser = { id: 'u1', email: 'a@b.com', displayName: 'A' };
const routerDecision = {
  route: 'professional' as const,
  scope: 'professional' as const,
  space: 'logistiga' as const,
  intent: 'task',
  complexity: 'low' as const,
  securityLevel: 'medium' as const,
  confidence: 0.9,
  method: 'rules' as const,
};

describe('ProfessionalAgentService — time context & confirmation-contract regressions', () => {
  let ctx: ReturnType<typeof buildService>;

  beforeEach(() => {
    ctx = buildService();
  });

  it('injects a real, freshly-computed time reference into the system prompt', async () => {
    await ctx.service.handle({ user, message: 'x', conversationId: 'c1', routerDecision });
    const systemPrompt = ctx.contextBuilder.build.mock.calls[0][0].systemPrompt as string;
    expect(systemPrompt).toContain('2026-09-23T09:00:00.000Z');
  });

  it('the system prompt forbids simulating a confirmation without a real tool call', async () => {
    await ctx.service.handle({ user, message: 'x', conversationId: 'c1', routerDecision });
    const systemPrompt = ctx.contextBuilder.build.mock.calls[0][0].systemPrompt as string;
    expect(systemPrompt).toMatch(/jamais.*confirmation/i);
  });

  it('a plain-text response with no toolCalls never fabricates one', async () => {
    ctx.llmService.complete.mockResolvedValue({
      configured: true,
      content: 'Créer une tâche : "X". Veux-tu confirmer ?',
      provider: 'openai',
      model: 'gpt-4o-mini',
    });
    const result = await ctx.service.handle({ user, message: 'x', conversationId: 'c1', routerDecision });
    expect(result.toolCalls).toBeUndefined();
  });
});
