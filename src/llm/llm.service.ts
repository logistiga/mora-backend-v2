import { Inject, Injectable, Logger } from '@nestjs/common';
import type {
  LlmCompletionRequest,
  LlmProviderInterface,
} from './llm-provider.interface.js';
import { LLM_PROVIDER } from './llm-provider.interface.js';

export interface LlmResponse {
  configured: boolean;
  content: string;
  provider: string;
  model: string | null;
}

const NOT_CONFIGURED_MESSAGE =
  "Configuration LLM manquante : aucun provider n'est configuré (OPENAI_API_KEY absent). " +
  'Cette réponse est un espace réservé — configurez un provider pour obtenir une vraie réponse.';

/**
 * Single entry point agents call instead of talking to a provider directly.
 * Never throws for a missing/misconfigured provider — always returns a
 * structured response so the app keeps running (see AGENTS §4).
 */
@Injectable()
export class LlmService {
  private readonly logger = new Logger(LlmService.name);

  constructor(@Inject(LLM_PROVIDER) private readonly provider: LlmProviderInterface) {}

  isConfigured(): boolean {
    return this.provider.isConfigured();
  }

  async complete(request: LlmCompletionRequest): Promise<LlmResponse> {
    if (!this.provider.isConfigured()) {
      return {
        configured: false,
        content: NOT_CONFIGURED_MESSAGE,
        provider: this.provider.name,
        model: null,
      };
    }

    try {
      const result = await this.provider.complete(request);
      return { configured: true, ...result };
    } catch (error) {
      this.logger.error('LLM completion failed', error instanceof Error ? error.stack : error);
      return {
        configured: true,
        content:
          "Le provider LLM est configuré mais la requête a échoué. Réessayez plus tard.",
        provider: this.provider.name,
        model: null,
      };
    }
  }
}
