import { Injectable } from '@nestjs/common';

/**
 * Combines VAD silence with a minimum-silence-duration rule to decide when
 * the user's turn is over (AGENTS Phase F §17). Deliberately NOT a second
 * LLM call for semantic endpointing — that would be over-engineering for
 * this MVP (§17: "ne surcomplexifie pas avec un second LLM si inutile").
 * The actual STT finalize() call is what turns the accumulated audio into
 * a transcript; this service only decides WHEN to call finalize().
 */
@Injectable()
export class EndOfTurnService {
  /** Minimum silence (ms) after VAD's own `speech_ended` before we trust it enough to finalize STT. */
  private readonly confirmSilenceMs = 300;

  /**
   * Given the timestamp VAD reported `speech_ended` and the current time,
   * returns true once it is safe to call sttSession.finalize().
   */
  isTurnOver(speechEndedAtMs: number, nowMs: number): boolean {
    return nowMs - speechEndedAtMs >= this.confirmSilenceMs;
  }
}
