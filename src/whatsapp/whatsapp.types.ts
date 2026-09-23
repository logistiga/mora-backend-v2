export const WHATSAPP_ACCOUNT_STATUSES = ['configured', 'connected', 'disconnected', 'error'] as const;

export interface AutoReplyPolicy {
  unknownContact: 'silent' | 'welcome_only';
  knownContact: 'draft_only' | 'silent';
  trustedContact: 'draft_only' | 'silent';
  neverAutoSend: true; // Phase E invariant — see AGENTS §29/§30: sending always requires confirmation
}

export const DEFAULT_AUTO_REPLY_POLICY: AutoReplyPolicy = {
  unknownContact: 'welcome_only',
  knownContact: 'draft_only',
  trustedContact: 'draft_only',
  neverAutoSend: true,
};
