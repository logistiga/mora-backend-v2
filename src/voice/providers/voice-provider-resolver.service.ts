import { Injectable, Logger } from '@nestjs/common';
import { AiProviderService } from '../../ai-providers/ai-provider.service.js';
import type { ResolvedProviderConnection } from '../../ai-providers/ai-provider.types.js';

/**
 * Resolves the STT/TTS credentials to use for a given user (AGENTS Phase F
 * §11/§40: "Réutiliser les credentials chiffrés DB quand approprié. Ne
 * révèle jamais la clé", and §63: never create a second secrets table when
 * `ai_providers` can reasonably handle it — confirmed during the Phase F
 * pre-coding audit that `kind` is a free string, so `kind: 'stt'|'tts'`
 * works against the existing table with zero schema changes).
 *
 * Fallback strategy: if the user has no dedicated `stt`/`tts` AiProvider
 * row, and their default `chat` provider is `openai`, reuse that same
 * encrypted API key — OpenAI's Whisper/TTS endpoints are billed on the same
 * account as its chat endpoint, so this never asks the user for a key they
 * haven't already provided. If neither exists, returns null and the caller
 * must degrade honestly (no fabricated transcript/audio).
 */
@Injectable()
export class VoiceProviderResolverService {
  private readonly logger = new Logger(VoiceProviderResolverService.name);

  constructor(private readonly aiProviderService: AiProviderService) {}

  async resolve(
    userId: string,
    kind: 'stt' | 'tts',
    params: { scope?: string; space?: string } = {},
  ): Promise<ResolvedProviderConnection | null> {
    const dedicated = await this.aiProviderService.getProviderForUseCase(userId, { kind, ...params });
    if (dedicated) return this.aiProviderService.toConnection(dedicated);

    // Fallback: reuse the chat provider's OpenAI credentials.
    const chatProvider = await this.aiProviderService.getProviderForUseCase(userId, { kind: 'chat', ...params });
    if (chatProvider && chatProvider.provider === 'openai') {
      this.logger.debug(`No dedicated "${kind}" provider for user; reusing chat provider's OpenAI credentials`);
      const chatConnection = this.aiProviderService.toConnection(chatProvider);
      return { ...chatConnection, kind, model: kind === 'stt' ? 'whisper-1' : 'tts-1' };
    }

    return null;
  }
}
