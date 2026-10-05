import { describe, expect, it } from 'vitest';
import { maskMcpKeyInUrl } from './mask-url.util.js';

describe('maskMcpKeyInUrl', () => {
  it('hides the key in an MCP path while keeping the route visible', () => {
    expect(maskMcpKeyInUrl('/api/v1/mcp/mora_abc123XYZ-_def')).toBe('/api/v1/mcp/mora_***');
  });

  it('leaves other URLs and missing values untouched', () => {
    expect(maskMcpKeyInUrl('/api/v1/skills?limit=5')).toBe('/api/v1/skills?limit=5');
    expect(maskMcpKeyInUrl(undefined)).toBeUndefined();
  });
});
