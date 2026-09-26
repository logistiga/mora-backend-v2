import { Injectable } from '@nestjs/common';
import type {
  AvatarChannel,
  AvatarExpression,
  AvatarExpressionPayload,
  AvatarLipSyncPayload,
  AvatarState,
  AvatarStatePayload,
  AvatarViseme,
} from './avatar.types.js';

@Injectable()
export class AvatarStateService {
  buildState(input: {
    state: AvatarState;
    channel: AvatarChannel;
    sessionId?: string;
    conversationId?: string;
    scope?: string;
    space?: string;
    sourceType?: string;
    pendingConfirmation?: boolean;
    errorCode?: string;
    connection?: 'connected' | 'reconnecting' | 'disconnected';
  }): AvatarStatePayload {
    const expression = inferExpression(input.state, input.channel, Boolean(input.pendingConfirmation), input.errorCode);
    return {
      state: input.state,
      channel: input.channel,
      expression,
      intensity: inferIntensity(input.state, input.channel),
      canInterrupt: input.state === 'speaking' || input.state === 'thinking' || input.state === 'confirming',
      pendingConfirmation: Boolean(input.pendingConfirmation),
      connection: input.connection ?? 'connected',
      sessionId: input.sessionId,
      conversationId: input.conversationId,
      scope: input.scope,
      space: input.space,
      sourceType: input.sourceType,
      errorCode: input.errorCode,
    };
  }

  buildExpression(input: {
    state: AvatarState;
    channel: AvatarChannel;
    pendingConfirmation?: boolean;
    errorCode?: string;
  }): AvatarExpressionPayload {
    return {
      expression: inferExpression(input.state, input.channel, Boolean(input.pendingConfirmation), input.errorCode),
      intensity: inferIntensity(input.state, input.channel),
      state: input.state,
      channel: input.channel,
      source: 'avatar_state_service',
    };
  }

  buildLipSyncPlan(input: { text: string; channel: AvatarChannel; voiceSpeed?: number; enabled?: boolean }): AvatarLipSyncPayload {
    if (!input.enabled || !input.text.trim()) {
      return { mode: 'disabled', source: 'estimated_text_timing', channel: input.channel, durationMs: 0, textLength: input.text.length, cues: [] };
    }

    const words = input.text
      .replace(/\s+/g, ' ')
      .trim()
      .split(' ')
      .filter(Boolean)
      .slice(0, 48);
    const baseDurationMs = clamp(Math.round((input.text.length * 72) / Math.max(input.voiceSpeed ?? 1, 0.5)), 900, 15000);
    const stepMs = Math.max(80, Math.round(baseDurationMs / Math.max(words.length, 1)));

    let cursor = 0;
    const cues = words.map((word) => {
      const durationMs = clamp(stepMs + Math.round(word.length * 12), 80, 420);
      const cue = {
        startMs: cursor,
        endMs: cursor + durationMs,
        viseme: wordToViseme(word),
        weight: 0.75,
      };
      cursor += durationMs;
      return cue;
    });

    return {
      mode: 'viseme_timeline',
      source: 'estimated_text_timing',
      channel: input.channel,
      durationMs: cues.at(-1)?.endMs ?? 0,
      textLength: input.text.length,
      cues,
    };
  }
}

function inferExpression(
  state: AvatarState,
  channel: AvatarChannel,
  pendingConfirmation: boolean,
  errorCode?: string,
): AvatarExpression {
  if (errorCode || state === 'error') return 'error';
  if (pendingConfirmation || state === 'confirming') return 'confirming';
  if (state === 'thinking') return channel === 'vision' || channel === 'voice_vision' ? 'vision_focus' : 'thinking';
  if (state === 'speaking') return channel === 'vision' || channel === 'voice_vision' ? 'vision_focus' : 'explaining';
  if (state === 'interrupted') return 'concerned';
  if (state === 'listening') return 'attentive';
  return 'neutral';
}

function inferIntensity(state: AvatarState, channel: AvatarChannel): number {
  if (state === 'error') return 0.95;
  if (state === 'confirming') return 0.82;
  if (state === 'speaking') return channel === 'vision' || channel === 'voice_vision' ? 0.78 : 0.72;
  if (state === 'thinking') return 0.58;
  if (state === 'interrupted') return 0.64;
  if (state === 'listening') return 0.46;
  return 0.35;
}

function wordToViseme(word: string): AvatarViseme {
  const normalized = word.toLowerCase();
  if (/[bmp]/.test(normalized)) return 'M';
  if (/[fv]/.test(normalized)) return 'F';
  if (/[lr]/.test(normalized)) return 'L';
  if (/[szcjx]/.test(normalized)) return 'S';
  if (/[ou]/.test(normalized)) return 'O';
  if (/[iy]/.test(normalized)) return 'I';
  if (/[eéèêë]/.test(normalized)) return 'E';
  if (/[aàâ]/.test(normalized)) return 'A';
  if (/[uùû]/.test(normalized)) return 'U';
  return 'sil';
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
