import { beforeEach, describe, expect, it } from 'vitest';
import { ToolRegistryService } from './tool-registry.service.js';
import type { MoraTool } from './tool.types.js';

function fakeTool(overrides: Partial<MoraTool> = {}): MoraTool {
  return {
    name: 'fake_tool',
    description: 'A fake tool',
    version: '1.0.0',
    securityLevel: 'N1',
    allowedScopes: ['personal', 'professional'],
    requiresConfirmation: false,
    jsonSchema: { type: 'object', properties: {} },
    validate: () => ({ valid: true, value: {} }),
    execute: async () => ({ ok: true }),
    ...overrides,
  };
}

describe('ToolRegistryService', () => {
  let registry: ToolRegistryService;

  beforeEach(() => {
    registry = new ToolRegistryService();
  });

  it('registers and retrieves a tool by name', () => {
    const tool = fakeTool();
    registry.register(tool);
    expect(registry.get('fake_tool')).toBe(tool);
  });

  it('returns null for an unknown tool', () => {
    expect(registry.get('does_not_exist')).toBeNull();
  });

  it('throws when the same tool name is registered twice', () => {
    registry.register(fakeTool());
    expect(() => registry.register(fakeTool())).toThrow(/already registered/);
  });

  it('list() returns every registered tool', () => {
    registry.register(fakeTool({ name: 'a' }));
    registry.register(fakeTool({ name: 'b' }));
    expect(registry.list().map((t) => t.name).sort()).toEqual(['a', 'b']);
  });

  it('listAvailableFor() filters by allowedScopes — the LLM never sees a tool outside its scope', () => {
    registry.register(fakeTool({ name: 'personal_only', allowedScopes: ['personal'] }));
    registry.register(fakeTool({ name: 'professional_only', allowedScopes: ['professional'] }));
    registry.register(fakeTool({ name: 'both', allowedScopes: ['personal', 'professional'] }));

    const personalTools = registry.listAvailableFor('personal').map((t) => t.name);
    expect(personalTools).toContain('personal_only');
    expect(personalTools).toContain('both');
    expect(personalTools).not.toContain('professional_only');
  });

  it('toLlmToolDefinitions() maps name/description/jsonSchema for the LLM, never internals', () => {
    registry.register(
      fakeTool({ name: 'x', description: 'desc', jsonSchema: { type: 'object', properties: { a: {} } } }),
    );
    const defs = registry.toLlmToolDefinitions('personal');
    expect(defs).toEqual([{ name: 'x', description: 'desc', parameters: { type: 'object', properties: { a: {} } } }]);
  });
});
