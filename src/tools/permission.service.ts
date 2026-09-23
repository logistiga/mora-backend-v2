import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { MoraTool, ToolContext } from './tool.types.js';

export interface PermissionCheckResult {
  allowed: boolean;
  reason?: string;
}

/**
 * The single place that decides whether a tool call is permitted, given who
 * is asking and in what scope/space. The LLM is never a security authority
 * (AGENTS Phase D §1) — every path into ToolExecutor goes through this
 * service, whether the call originated from the LLM or a direct REST call.
 *
 * Cross-scope isolation itself is enforced structurally rather than by a
 * runtime branch here: `ToolContext.scope` is typed 'personal' |
 * 'professional' only, and the orchestrator never dispatches a tool call for
 * a 'hybrid' or 'direct' route (see MoraOrchestratorService.dispatch) — so a
 * hybrid/cross-scope request never reaches a tool at all. Every tool
 * implementation additionally scopes its own DB queries by
 * (userId, scope, space), and each Professional space (logistiga/piston/
 * code) is isolated from the others the same way. `crossScopeEnabled` is
 * exposed read-only here (mirroring the orchestrator's own flag, AGENTS
 * §6) for callers/tests that want to assert Phase D's default posture.
 */
@Injectable()
export class PermissionService {
  private readonly logger = new Logger(PermissionService.name);
  readonly crossScopeEnabled: boolean;

  constructor(configService: ConfigService) {
    this.crossScopeEnabled = configService.get<boolean>('app.crossScopeEnabled') ?? false;
    if (this.crossScopeEnabled) {
      this.logger.warn('MORA_CROSS_SCOPE_ENABLED=true: Phase D tools still never act across scope/space boundaries');
    }
  }

  check(context: ToolContext, tool: MoraTool): PermissionCheckResult {
    if (!tool) {
      return { allowed: false, reason: 'tool_not_found' };
    }

    if (!tool.allowedScopes.includes(context.scope)) {
      return { allowed: false, reason: 'scope_not_allowed' };
    }

    if (tool.securityLevel === 'N4') {
      // Phase D ships no real N4 tool, but this is the hard backstop even if
      // one were ever registered: never auto-executed, never approvable.
      return { allowed: false, reason: 'security_level_n4_blocked' };
    }

    return { allowed: true };
  }
}
