import { describe, expect, it, vi } from 'vitest';
import { CreateMemoryTool } from './create-memory.tool.js';
import type { ToolContext } from '../tool.types.js';

const context: ToolContext = {
  userId: 'u1',
  conversationId: 'conv-1',
  scope: 'personal',
  space: 'personal',
  route: 'personal',
};

function buildTool() {
  const memoryService = {
    create: vi.fn(async (_userId: string, dto: Record<string, unknown>) => ({
      id: 'mem-1',
      kind: dto.kind,
      content: dto.content,
      scope: dto.scope,
      space: dto.space,
    })),
  };
  return { tool: new CreateMemoryTool(memoryService as never), memoryService };
}

describe('CreateMemoryTool', () => {
  it('is an N1 tool that needs no confirmation', () => {
    const { tool } = buildTool();
    expect(tool.name).toBe('create_memory');
    expect(tool.securityLevel).toBe('N1');
    expect(tool.requiresConfirmation).toBe(false);
  });

  it('rejects empty content', () => {
    const { tool } = buildTool();
    expect(tool.validate({ content: '' }).valid).toBe(false);
  });

  it('rejects an unknown memory kind', () => {
    const { tool } = buildTool();
    expect(tool.validate({ content: 'x', kind: 'nope' }).valid).toBe(false);
  });

  it('stores the memory in the conversation scope/space, never from LLM input', async () => {
    const { tool, memoryService } = buildTool();

    const result = await tool.execute(context, {
      content: 'Le plat préféré de l\'utilisateur est le couscous.',
      // scope/space are not part of the schema; even if the model sent them
      // they cannot reach MemoryService.
    } as never);

    expect(result.ok).toBe(true);
    expect(memoryService.create).toHaveBeenCalledWith(
      'u1',
      expect.objectContaining({ scope: 'personal', space: 'personal', kind: 'fact' }),
      'manual',
      'conv-1',
    );
  });
});
