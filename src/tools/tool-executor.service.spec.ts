import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PermissionService } from './permission.service.js';
import { ToolExecutorService } from './tool-executor.service.js';
import { ToolRegistryService } from './tool-registry.service.js';
import type { MoraTool, ToolContext } from './tool.types.js';

function fakeTool(overrides: Partial<MoraTool> = {}): MoraTool {
  return {
    name: 'fake_tool',
    description: 'x',
    version: '1.0.0',
    securityLevel: 'N1',
    allowedScopes: ['personal', 'professional'],
    requiresConfirmation: false,
    jsonSchema: { type: 'object', properties: {} },
    validate: () => ({ valid: true, value: {} }),
    execute: async () => ({ ok: true, data: { done: true } }),
    ...overrides,
  };
}

function buildExecutor() {
  const registry = new ToolRegistryService();
  const permissions = new PermissionService({ get: () => false } as never);
  const prismaMock = {
    toolCall: {
      create: vi.fn(async (args: { data: Record<string, unknown> }) => ({ id: 'tc-1', ...args.data })),
      update: vi.fn(async () => ({})),
    },
    pendingAction: {
      create: vi.fn(async (args: { data: Record<string, unknown> }) => ({ id: 'pa-1', ...args.data })),
    },
  };
  const auditMock = { log: vi.fn() };

  const executor = new ToolExecutorService(registry, permissions, prismaMock as never, auditMock as never);
  return { executor, registry, prismaMock, auditMock };
}

const context: ToolContext = { userId: 'u1', scope: 'personal', space: 'personal', route: 'personal' };

describe('ToolExecutorService', () => {
  let ctx: ReturnType<typeof buildExecutor>;

  beforeEach(() => {
    ctx = buildExecutor();
  });

  it('rejects an unknown/hallucinated tool without executing anything', async () => {
    const outcome = await ctx.executor.requestExecution('delete_everything', {}, context);
    expect(outcome).toEqual({ kind: 'rejected', reason: 'unknown_tool' });
    expect(ctx.prismaMock.pendingAction.create).not.toHaveBeenCalled();
  });

  it('rejects invalid arguments (backend validation, never trusting the LLM)', async () => {
    const tool = fakeTool({ validate: () => ({ valid: false, errors: ['title is required'] }) });
    ctx.registry.register(tool);

    const outcome = await ctx.executor.requestExecution('fake_tool', {}, context);
    expect(outcome.kind).toBe('rejected');
    expect((outcome as { reason: string }).reason).toContain('invalid_arguments');
  });

  it('blocks N4 and never executes it, even if requested', async () => {
    const tool = fakeTool({ securityLevel: 'N4' });
    ctx.registry.register(tool);

    const outcome = await ctx.executor.requestExecution('fake_tool', {}, context);
    expect(outcome).toEqual({ kind: 'rejected', reason: 'security_level_n4_blocked' });
  });

  it('rejects a tool outside the caller\'s scope (wrong scope)', async () => {
    const tool = fakeTool({ allowedScopes: ['professional'] });
    ctx.registry.register(tool);

    const outcome = await ctx.executor.requestExecution('fake_tool', {}, context);
    expect(outcome).toEqual({ kind: 'rejected', reason: 'scope_not_allowed' });
  });

  it('N1: executes immediately, no pending_action created', async () => {
    const tool = fakeTool({ securityLevel: 'N1', requiresConfirmation: false });
    ctx.registry.register(tool);

    const outcome = await ctx.executor.requestExecution('fake_tool', {}, context);
    expect(outcome.kind).toBe('executed');
    if (outcome.kind === 'executed') {
      expect(outcome.result.ok).toBe(true);
      expect(outcome.result.data).toEqual({ done: true });
    }
    expect(ctx.prismaMock.pendingAction.create).not.toHaveBeenCalled();
  });

  it('N2: never executes directly — creates a pending_action and returns a summary', async () => {
    const tool = fakeTool({ securityLevel: 'N2', requiresConfirmation: true });
    ctx.registry.register(tool);
    const execute = vi.spyOn(tool, 'execute');

    const outcome = await ctx.executor.requestExecution('fake_tool', {}, context);
    expect(outcome.kind).toBe('pending_confirmation');
    expect(execute).not.toHaveBeenCalled();
    expect(ctx.prismaMock.pendingAction.create).toHaveBeenCalledOnce();
  });

  it('N3: same as N2 — never executes directly, creates a pending_action', async () => {
    const tool = fakeTool({ securityLevel: 'N3', requiresConfirmation: true });
    ctx.registry.register(tool);
    const execute = vi.spyOn(tool, 'execute');

    const outcome = await ctx.executor.requestExecution('fake_tool', {}, context);
    expect(outcome.kind).toBe('pending_confirmation');
    expect(execute).not.toHaveBeenCalled();
  });

  it('a thrown exception inside a tool never crashes the caller — recorded as failed', async () => {
    const tool = fakeTool({
      securityLevel: 'N1',
      execute: async () => {
        throw new Error('boom');
      },
    });
    ctx.registry.register(tool);

    const outcome = await ctx.executor.requestExecution('fake_tool', {}, context);
    expect(outcome.kind).toBe('executed');
    if (outcome.kind === 'executed') {
      expect(outcome.result.ok).toBe(false);
      expect(outcome.result.errorCode).toBe('tool_exception');
    }
  });

  it('generates a fresh idempotencyKey for every new pending_action', async () => {
    const tool = fakeTool({ securityLevel: 'N2', requiresConfirmation: true });
    ctx.registry.register(tool);

    await ctx.executor.requestExecution('fake_tool', {}, context);
    await ctx.executor.requestExecution('fake_tool', {}, context);

    const keys = ctx.prismaMock.pendingAction.create.mock.calls.map((call: unknown[]) => {
      const args = call[0] as { data: { idempotencyKey: string } };
      return args.data.idempotencyKey;
    });
    expect(keys[0]).not.toBe(keys[1]);
  });
});
