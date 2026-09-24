import { Injectable, Logger } from '@nestjs/common';
import type { ResolvedProviderConnection } from '../../ai-providers/ai-provider.types.js';
import { LlmCallLogger } from '../../ai-providers/llm-call-logger.service.js';
import type { TextToSpeechProviderInterface } from './tts-provider.interface.js';

const DEFAULT_BASE_URL = 'https://api.openai.com/v1';

/**
 * REAL adapter for OpenAI's /v1/audio/speech. Unlike STT, this endpoint
 * genuinely streams its HTTP response body as audio bytes become available
 * (AGENTS Phase F §14) — `synthesizeStream` reads `response.body` as a
 * ReadableStream and yields each chunk as it arrives, so the caller can
 * start playing audio before the full sentence has finished synthesizing.
 */
@Injectable()
export class OpenAiTtsProvider implements TextToSpeechProviderInterface {
  readonly providerName = 'openai-tts';

  private readonly logger = new Logger(OpenAiTtsProvider.name);

  constructor(
    private readonly connection: ResolvedProviderConnection,
    private readonly callLogger: LlmCallLogger,
    private readonly userId: string,
  ) {}

  async *synthesizeStream(params: {
    text: string;
    voiceId: string;
    language: string;
    speed: number;
    signal: AbortSignal;
  }): AsyncGenerator<Buffer, void, unknown> {
    const started = Date.now();
    let firstByteMs: number | undefined;
    const baseUrl = this.connection.baseUrl || DEFAULT_BASE_URL;
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.connection.apiKey) headers.Authorization = `Bearer ${this.connection.apiKey}`;

    let response: Response;
    try {
      response = await fetch(`${baseUrl}/audio/speech`, {
        method: 'POST',
        headers,
        signal: params.signal,
        body: JSON.stringify({
          model: this.connection.model || 'tts-1',
          voice: params.voiceId || 'alloy',
          input: params.text,
          speed: params.speed || 1.0,
          response_format: 'mp3',
        }),
      });
    } catch (error) {
      if (params.signal.aborted) return; // barge-in: silent, expected
      this.logger.warn(`TTS request threw: ${String(error)}`);
      await this.callLogger.log({
        userId: this.userId,
        providerId: this.connection.providerRowId,
        kind: 'tts',
        model: this.connection.model || 'tts-1',
        latencyMs: Date.now() - started,
        status: 'error',
        errorCode: 'network_error',
      });
      return;
    }

    if (!response.ok || !response.body) {
      await this.callLogger.log({
        userId: this.userId,
        providerId: this.connection.providerRowId,
        kind: 'tts',
        model: this.connection.model || 'tts-1',
        latencyMs: Date.now() - started,
        status: 'error',
        errorCode: `http_${response.status}`,
      });
      return;
    }

    const reader = response.body.getReader();
    try {
      while (true) {
        if (params.signal.aborted) {
          await reader.cancel().catch(() => undefined);
          return;
        }
        const { done, value } = await reader.read();
        if (done) break;
        if (value && value.length > 0) {
          if (firstByteMs === undefined) firstByteMs = Date.now() - started;
          yield Buffer.from(value);
        }
      }
      await this.callLogger.log({
        userId: this.userId,
        providerId: this.connection.providerRowId,
        kind: 'tts',
        model: this.connection.model || 'tts-1',
        latencyMs: Date.now() - started,
        status: 'success',
      });
    } catch (error) {
      if (!params.signal.aborted) this.logger.warn(`TTS stream read failed: ${String(error)}`);
    }
  }
}
