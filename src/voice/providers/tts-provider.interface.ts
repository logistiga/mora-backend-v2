/**
 * Provider-neutral Text-to-Speech contract (AGENTS Phase F §14). Streaming
 * is the primary shape (a client hears the first sentence while later ones
 * are still being synthesized) — see OpenAiTtsProvider for the real,
 * genuinely-stream-capable implementation shipped in Phase F.
 */
export interface TextToSpeechProviderInterface {
  readonly providerName: string;

  /**
   * Synthesizes `text` and yields raw audio bytes as they become available.
   * `signal` aborts synthesis immediately (barge-in) — the caller MUST stop
   * consuming the generator and must not emit any further chunk once
   * aborted.
   */
  synthesizeStream(params: {
    text: string;
    voiceId: string;
    language: string;
    speed: number;
    signal: AbortSignal;
  }): AsyncGenerator<Buffer, void, unknown>;
}
