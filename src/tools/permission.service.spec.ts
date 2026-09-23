import { describe, expect, it } from 'vitest';
import { PermissionService } from './permission.service.js';
import type { MoraTool, ToolContext } from './tool.types.js';

function buildService(crossScopeEnabled = false) {
  const configService = { get: () => crossScopeEnabled };
  return new PermissionService(configService as never);
}

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
    execute: async () => ({ ok: true }),
    ...overrides,
  };
}

const baseContext: ToolContext = {
  userId: 'u1',
  scope: 'personal',
  space: 'personal',
  route: 'personal',
};

describe('PermissionService', () => {
  it('allows a tool whose allowedScopes includes the context scope', () => {
    const permissions = buildService();
    const result = permissions.check(baseContext, fakeTool());
    expect(result.allowed).toBe(true);
  });

  it('rejects a tool not allowed in this scope', () => {
    const permissions = buildService();
    const tool = fakeTool({ allowedScopes: ['professional'] });
    const result = permissions.check(baseContext, tool);
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('scope_not_allowed');
  });

  it('never allows an N4 tool, regardless of scope', () => {
    const permissions = buildService();
    const tool = fakeTool({ securityLevel: 'N4' });
    const result = permissions.check(baseContext, tool);
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('security_level_n4_blocked');
  });

  it('rejects a missing tool', () => {
    const permissions = buildService();
    const result = permissions.check(baseContext, null as unknown as MoraTool);
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('tool_not_found');
  });

  it('exposes crossScopeEnabled read-only, defaulting to false (Phase D default posture)', () => {
    expect(buildService(false).crossScopeEnabled).toBe(false);
    expect(buildService(true).crossScopeEnabled).toBe(true);
  });

  it('still blocks N4 even when cross-scope is enabled', () => {
    const permissions = buildService(true);
    const result = permissions.check(baseContext, fakeTool({ securityLevel: 'N4' }));
    expect(result.allowed).toBe(false);
  });
});
