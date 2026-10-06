import { Injectable, Logger } from '@nestjs/common';
import type { ResolvedProviderConnection } from '../../ai-providers/ai-provider.types.js';
import { LlmCallLogger } from '../../ai-providers/llm-call-logger.service.js';
import type { TextToSpeechProviderInterface } from './tts-provider.interface.js';

const DEFAULT_BASE_URL = 'https://api.openai.com/v1';
const DEFAULT_MODEL = 'tts-1';
/** Newer model: noticeably more natural prose, and it accepts delivery instructions. */
const NATURAL_MODEL = 'gpt-4o-mini-tts';
const NATURAL_VOICE = 'marin';
const NATURAL_INSTRUCTIONS =
  'Parle comme une assistante naturelle et chaleureuse : phrases fluides, rythme conversationnel, pauses courtes entre les idées, ton calme et attentif.';

/**
 * REAL adapter for OpenAI's /v1/audio/speech. Unlike STT, this endpoint
 * genuinely streams its HTTP response body as audio bytes become available
 * (AGENTS Phase F §14) — `synthesizeStream` reads `response.body` as a
 * ReadableStream and yields each chunk as it arrives, so the caller can
 * start playing audio before the full sentence has finished synthesizing.
 *
 * The legacy `tts-1` family is upgraded to the natural model. If that model
 * is refused for this account, the request falls back to the configured model
 * so the user still hears a reply instead of silence.
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
    const configuredModel = this.connection.model || DEFAULT_MODEL;
    const wantsNatural = configuredModel === DEFAULT_MODEL || configuredModel === NATURAL_MODEL;

    let model = wantsNatural ? NATURAL_MODEL : configuredModel;
    let voice = wantsNatural && (!params.voiceId || params.voiceId === 'alloy') ? NATURAL_VOICE : params.voiceId || 'alloy';
    const first = await this.requestSpeech(model, voice, params);
    if (typeof first === 'string') return;
    let response = first;
    if (!response.ok && model !== configuredModel) {
      this.logger.warn(`TTS model ${model} refused (${response.status}), falling back to ${configuredModel}`);
      model = configuredModel;
      voice = params.voiceId || 'alloy';
      const second = await this.requestSpeech(model, voice, params);
      if (typeof second === 'string') return;
      response = second;
    }

    if (!response.ok || !response.body) {
      await this.callLogger.log({
        userId: this.userId,
        providerId: this.connection.providerRowId,
        kind: 'tts',
        model,
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
        model,
        latencyMs: Date.now() - started,
        status: 'success',
      });
    } catch (error) {
      if (!params.signal.aborted) this.logger.warn(`TTS stream read failed: ${String(error)}`);
    }
  }

  /** Returns the response, or 'aborted' (barge-in) / 'failed' (network error, already logged). */
  private async requestSpeech(
    model: string,
    voice: string,
    params: { text: string; speed: number; signal: AbortSignal },
  ): Promise<Response | 'aborted' | 'failed'> {
    const baseUrl = this.connection.baseUrl || DEFAULT_BASE_URL;
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.connection.apiKey) headers.Authorization = `Bearer ${this.connection.apiKey}`;
    const body: Record<string, unknown> = {
      model,
      voice,
      input: params.text,
      speed: params.speed || 1.0,
      response_format: 'mp3',
    };
    if (model === NATURAL_MODEL) body.instructions = NATURAL_INSTRUCTIONS;

    const started = Date.now();
    try {
      return await fetch(`${baseUrl}/audio/speech`, {
        method: 'POST',
        headers,
        signal: params.signal,
        body: JSON.stringify(body),
      });
    } catch (error) {
      if (params.signal.aborted) return 'aborted'; // barge-in: silent, expected
      this.logger.warn(`TTS request threw: ${String(error)}`);
      await this.callLogger.log({
        userId: this.userId,
        providerId: this.connection.providerRowId,
        kind: 'tts',
        model,
        latencyMs: Date.now() - started,
        status: 'error',
        errorCode: 'network_error',
      });
      return 'failed';
    }
  }
}
