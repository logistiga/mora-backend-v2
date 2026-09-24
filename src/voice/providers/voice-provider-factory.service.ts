import { Injectable, Logger } from '@nestjs/common';
import { LlmCallLogger } from '../../ai-providers/llm-call-logger.service.js';
import { OpenAiSttProvider } from './openai-stt.provider.js';
import { OpenAiTtsProvider } from './openai-tts.provider.js';
import { VoiceProviderResolverService } from './voice-provider-resolver.service.js';
import type { SpeechToTextProviderInterface } from './stt-provider.interface.js';
import type { TextToSpeechProviderInterface } from './tts-provider.interface.js';

/**
 * Builds per-user STT/TTS provider instances (they carry a resolved,
 * decrypted connection, so they cannot be a singleton Nest provider shared
 * across users). Returns null when the user has genuinely no usable
 * credentials — callers must degrade honestly (AGENTS Phase F §33: never
 * fabricate a transcript/audio when no provider is configured).
 */
@Injectable()
export class VoiceProviderFactoryService {
  private readonly logger = new Logger(VoiceProviderFactoryService.name);

  constructor(
    private readonly resolver: VoiceProviderResolverService,
    private readonly callLogger: LlmCallLogger,
  ) {}

  async createStt(
    userId: string,
    params: { scope?: string; space?: string } = {},
  ): Promise<SpeechToTextProviderInterface | null> {
    const connection = await this.resolver.resolve(userId, 'stt', params);
    if (!connection) {
      this.logger.warn(`No STT provider (dedicated or reusable OpenAI chat credentials) for user ${userId}`);
      return null;
    }
    return new OpenAiSttProvider(connection, this.callLogger, userId);
  }

  async createTts(
    userId: string,
    params: { scope?: string; space?: string } = {},
  ): Promise<TextToSpeechProviderInterface | null> {
    const connection = await this.resolver.resolve(userId, 'tts', params);
    if (!connection) {
      this.logger.warn(`No TTS provider (dedicated or reusable OpenAI chat credentials) for user ${userId}`);
      return null;
    }
    return new OpenAiTtsProvider(connection, this.callLogger, userId);
  }
}
