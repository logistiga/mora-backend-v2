export const TRUST_LEVELS = ['unknown', 'known', 'trusted', 'vip', 'restricted', 'blocked'] as const;
export type TrustLevel = (typeof TRUST_LEVELS)[number];

export const CONTACT_IDENTITY_TYPES = ['whatsapp', 'email'] as const;
export type ContactIdentityType = (typeof CONTACT_IDENTITY_TYPES)[number];

export const CONTACT_SCOPES = ['personal', 'professional'] as const;

/** E.164-ish normalization for WhatsApp numbers, lowercase for email — the actual dedup key (AGENTS §22). */
export function normalizeIdentityValue(type: ContactIdentityType, raw: string): string {
  if (type === 'email') return raw.trim().toLowerCase();
  return raw.replace(/[^0-9+]/g, '');
}
