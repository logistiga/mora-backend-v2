const MCP_KEY_IN_PATH = /(\/mcp\/)mora_[A-Za-z0-9_-]+/g;

/** Hides a Mora API key carried in an MCP URL path so it never reaches the logs. */
export function maskMcpKeyInUrl(url: string | undefined): string | undefined {
  return url?.replace(MCP_KEY_IN_PATH, '$1mora_***');
}
