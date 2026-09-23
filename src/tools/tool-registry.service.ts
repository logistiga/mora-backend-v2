import { Injectable, Logger } from '@nestjs/common';
import type { LlmToolDefinition } from '../llm/llm-provider.interface.js';
import type { MoraTool, ToolScope } from './tool.types.js';

/**
 * Central catalog of every MoraTool. Tools register themselves here (via
 * ToolsModule's provider factory, see tools.module.ts) instead of being
 * reached directly by controllers/LLM code — nothing outside ToolExecutor
 * ever calls `tool.execute()` (AGENTS Phase D §5).
 */
@Injectable()
export class ToolRegistryService {
  private readonly logger = new Logger(ToolRegistryService.name);
  private readonly tools = new Map<string, MoraTool>();

  register(tool: MoraTool): void {
    if (this.tools.has(tool.name)) {
      throw new Error(`Tool "${tool.name}" is already registered`);
    }
    this.tools.set(tool.name, tool);
    this.logger.debug(`Registered tool "${tool.name}" (${tool.securityLevel})`);
  }

  get(name: string): MoraTool | null {
    return this.tools.get(name) ?? null;
  }

  list(): MoraTool[] {
    return [...this.tools.values()];
  }

  /**
   * The LLM must only ever see tools it could actually be allowed to call in
   * this context — never the full catalog. This is the "tool visibility"
   * half of the confirmation model (AGENTS Phase D §4); the real authority
   * check still happens again in PermissionService/ToolExecutor before
   * anything executes.
   */
  listAvailableFor(scope: ToolScope): MoraTool[] {
    return this.list().filter((tool) => tool.allowedScopes.includes(scope));
  }

  /** Provider-neutral tool definitions for everything visible in this scope — fed to LlmService.complete(). */
  toLlmToolDefinitions(scope: ToolScope): LlmToolDefinition[] {
    return this.listAvailableFor(scope).map((tool) => ({
      name: tool.name,
      description: tool.description,
      parameters: tool.jsonSchema as unknown as Record<string, unknown>,
    }));
  }
}
