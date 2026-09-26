export const AVATAR_CHANNELS = ['text', 'voice', 'vision', 'voice_vision'] as const;
export type AvatarChannel = (typeof AVATAR_CHANNELS)[number];

export const AVATAR_RENDER_MODES = ['expressive_orb', 'humanoid_placeholder', 'minimal'] as const;
export type AvatarRenderMode = (typeof AVATAR_RENDER_MODES)[number];

export const AVATAR_STATES = [
  'idle',
  'listening',
  'thinking',
  'speaking',
  'confirming',
  'interrupted',
  'paused',
  'error',
  'disconnected',
] as const;
export type AvatarState = (typeof AVATAR_STATES)[number];

export const AVATAR_EXPRESSIONS = [
  'neutral',
  'attentive',
  'thinking',
  'explaining',
  'vision_focus',
  'confirming',
  'celebrating',
  'concerned',
  'error',
] as const;
export type AvatarExpression = (typeof AVATAR_EXPRESSIONS)[number];

export const AVATAR_LIP_SYNC_MODES = ['viseme_timeline', 'disabled'] as const;
export type AvatarLipSyncMode = (typeof AVATAR_LIP_SYNC_MODES)[number];

export const AVATAR_VISEMES = ['sil', 'A', 'E', 'I', 'O', 'U', 'M', 'F', 'L', 'S'] as const;
export type AvatarViseme = (typeof AVATAR_VISEMES)[number];

export interface AvatarStatePayload {
  state: AvatarState;
  channel: AvatarChannel;
  expression: AvatarExpression;
  intensity: number;
  canInterrupt: boolean;
  pendingConfirmation: boolean;
  connection: 'connected' | 'reconnecting' | 'disconnected';
  sessionId?: string;
  conversationId?: string;
  scope?: string;
  space?: string;
  sourceType?: string;
  errorCode?: string;
}

export interface AvatarExpressionPayload {
  expression: AvatarExpression;
  intensity: number;
  state: AvatarState;
  channel: AvatarChannel;
  source: 'avatar_state_service';
}

export interface AvatarLipSyncCue {
  startMs: number;
  endMs: number;
  viseme: AvatarViseme;
  weight: number;
}

export interface AvatarLipSyncPayload {
  mode: AvatarLipSyncMode;
  source: 'estimated_text_timing';
  channel: AvatarChannel;
  durationMs: number;
  textLength: number;
  cues: AvatarLipSyncCue[];
}

export interface AvatarProfileView {
  id: string;
  name: string;
  avatarPreset: string;
  renderMode: AvatarRenderMode;
  baseExpression: AvatarExpression;
  expressionIntensity: number;
  lipSyncMode: AvatarLipSyncMode;
  voiceSyncEnabled: boolean;
  idleEnabled: boolean;
  reducedMotion: boolean;
  settings: Record<string, unknown> | null;
  createdAt: Date;
  updatedAt: Date;
}
