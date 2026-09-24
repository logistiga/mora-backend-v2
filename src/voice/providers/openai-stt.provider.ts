import { Injectable, Logger } from '@nestjs/common';
import type { ResolvedProviderConnection } from '../../ai-providers/ai-provider.types.js';
import { LlmCallLogger } from '../../ai-providers/llm-call-logger.service.js';
import { VOICE_AUDIO_FORMAT } from '../voice.types.js';
import { pcm16ToWav } from './pcm-to-wav.util.js';
import type { SpeechToTextProviderInterface, SttSession } from './stt-provider.interface.js';

const DEFAULT_BASE_URL = 'https://api.openai.com/v1';

/**
 * REAL adapter for OpenAI's /v1/audio/transcriptions (Whisper). HONESTY
 * NOTE (AGENTS Phase F §11, §69): this endpoint is BATCH — it accepts one
 * complete audio file per request and returns one final transcript. It does
 * NOT stream partial transcripts while audio is still arriving.
 * `supportsPartialTranscripts` is therefore `false`, and this session
 * accumulates PCM frames in memory until `finalize()` is called (once per
 * voice turn, driven by EndOfTurnService) rather than pretending to offer
 * incremental partials it cannot produce.
 */
@Injectable()
export class OpenAiSttProvider implements SpeechToTextProviderInterface {
  readonly providerName = 'openai-whisper';
  readonly supportsPartialTranscripts = false;

  private readonly logger = new Logger(OpenAiSttProvider.name);

  constructor(
    private readonly connection: ResolvedProviderConnection,
    private readonly callLogger: LlmCallLogger,
    private readonly userId: string,
  ) {}

  startSession(params: { language: string }): SttSession {
    const frames: Buffer[] = [];
    let aborted = false;

    return {
      pushAudio: (frame: Buffer) => {
        if (!aborted) frames.push(frame);
      },
      finalize: async (): Promise<string> => {
        if (aborted || frames.length === 0) return '';
        const pcm = Buffer.concat(frames);
        const wav = pcm16ToWav(pcm, VOICE_AUDIO_FORMAT.sampleRateHz, VOICE_AUDIO_FORMAT.channels);
        const started = Date.now();

        try {
          const baseUrl = this.connection.baseUrl || DEFAULT_BASE_URL;
          const form = new FormData();
          form.append('file', new Blob([new Uint8Array(wav)], { type: 'audio/wav' }), 'audio.wav');
          form.append('model', this.connection.model || 'whisper-1');
          if (params.language && params.language !== 'auto') {
            form.append('language', mapLanguageCode(params.language));
          }

          const headers: Record<string, string> = {};
          if (this.connection.apiKey) headers.Authorization = `Bearer ${this.connection.apiKey}`;

          const response = await fetch(`${baseUrl}/audio/transcriptions`, {
            method: 'POST',
            headers,
            body: form,
          });

          const latencyMs = Date.now() - started;

          if (!response.ok) {
            const errText = await response.text().catch(() => '');
            await this.callLogger.log({
              userId: this.userId,
              providerId: this.connection.providerRowId,
              kind: 'stt',
              model: this.connection.model || 'whisper-1',
              latencyMs,
              status: 'error',
              errorCode: `http_${response.status}`,
            });
            this.logger.warn(`STT request failed: ${response.status} ${errText.slice(0, 200)}`);
            return '';
          }

          const data = (await response.json()) as { text?: string };
          await this.callLogger.log({
            userId: this.userId,
            providerId: this.connection.providerRowId,
            kind: 'stt',
            model: this.connection.model || 'whisper-1',
            latencyMs,
            status: 'success',
          });
          return data.text ?? '';
        } catch (error) {
          this.logger.warn(`STT request threw: ${String(error)}`);
          await this.callLogger.log({
            userId: this.userId,
            providerId: this.connection.providerRowId,
            kind: 'stt',
            model: this.connection.model || 'whisper-1',
            latencyMs: Date.now() - started,
            status: 'error',
            errorCode: 'network_error',
          });
          return '';
        }
      },
      abort: () => {
        aborted = true;
        frames.length = 0;
      },
    };
  }
}

function mapLanguageCode(language: string): string {
  // Whisper expects ISO-639-1. 'darija' has no dedicated code; ISO doesn't
  // distinguish it from Standard Arabic, so we honestly map it to 'ar'
  // rather than inventing a non-standard code the API would reject.
  if (language === 'darija') return 'ar';
  return language;
}
