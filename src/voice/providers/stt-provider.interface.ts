/**
 * Provider-neutral Speech-to-Text contract (AGENTS Phase F §11). One
 * implementation ships in Phase F (OpenAiSttProvider, REAL — see its file
 * header for the honest streaming-vs-batch disclosure). This interface is
 * what lets a future Deepgram/Google/Azure/local-Whisper adapter register
 * without touching VoiceSessionService or the gateway.
 */
export interface SttSession {
  /** Push one raw PCM16LE audio frame captured during this STT session. */
  pushAudio(frame: Buffer): void;
  /**
   * Ask the provider to produce a final transcript for everything pushed so
   * far, and close the session. Resolves with the final text (never partial).
   */
  finalize(): Promise<string>;
  /** Abort without producing a transcript (used on interruption). */
  abort(): void;
}

export interface SpeechToTextProviderInterface {
  readonly providerName: string;
  /**
   * true only if this provider can emit true incremental partial
   * transcripts while audio is still streaming in. OpenAI's
   * /v1/audio/transcriptions endpoint used in Phase F does NOT — it is
   * batch-only, so this is false here and must stay honest (AGENTS §11,
   * §69: never claim REAL streaming without an actual streaming call).
   */
  readonly supportsPartialTranscripts: boolean;

  startSession(params: { language: string }): SttSession;
}
