import { Injectable, Logger } from '@nestjs/common';
import { AiProviderService } from './ai-provider.service.js';
import type { ResolvedProviderConnection } from './ai-provider.types.js';

export interface ModelSelectionParams {
  kind: string;
  scope?: string;
  space?: string;
  /** Accepted for forward-compatibility — not yet used to change the selected
   *  provider (see class doc). */
  route?: string;
  complexity?: string;
  securityLevel?: string;
}

/**
 * Chooses which AiProvider row (if any) should handle one call.
 *
 * Phase C.5 rule (deliberately simple, per AGENTS §11 — "commencer avec des
 * règles simples et documentées"): delegate straight to
 * `AiProviderService.getProviderForUseCase()`, which already picks the most
 * specific active provider (exact scope+space > scope-only > global),
 * preferring the default, then higher priority. `route`/`complexity`/
 * `securityLevel` are accepted here so callers (and future phases) can pass
 * them without an API change, but they do not yet influence which row is
 * picked — there is only ever one candidate pool per (kind, scope, space)
 * today. A future phase can extend `AiProviderService.getProviderForUseCase`
 * (or add per-complexity provider tagging) without touching this signature.
 */
@Injectable()
export class AiModelSelectorService {
  private readonly logger = new Logger(AiModelSelectorService.name);

  constructor(private readonly aiProviderService: AiProviderService) {}

  async selectProvider(
    userId: string,
    params: ModelSelectionParams,
  ): Promise<ResolvedProviderConnection | null> {
    const row = await this.aiProviderService.getProviderForUseCase(userId, {
      kind: params.kind,
      scope: params.scope,
      space: params.space,
    });
    if (!row) {
      return null;
    }

    this.logger.debug(
      `Selected provider ${row.id} (${row.provider}/${row.model}) for kind=${params.kind} scope=${params.scope ?? '-'} space=${params.space ?? '-'}`,
    );
    return this.aiProviderService.toConnection(row);
  }
}
