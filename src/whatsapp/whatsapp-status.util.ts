export type WhatsAppDeliveryStatus = 'sent' | 'delivered' | 'read' | 'failed';

/**
 * Evolution API v2.3.1 `messages.update` statuses (src/api/types/wa.types.ts:
 * ERROR | PENDING | SERVER_ACK | DELIVERY_ACK | READ | DELETED | PLAYED).
 * Returns null for states that carry no delivery information for us.
 */
export function mapEvolutionStatus(status: unknown): WhatsAppDeliveryStatus | null {
  switch (status) {
    case 'SERVER_ACK':
    case 'PENDING':
      return 'sent';
    case 'DELIVERY_ACK':
      return 'delivered';
    case 'READ':
    case 'PLAYED':
      return 'read';
    case 'ERROR':
      return 'failed';
    default:
      return null;
  }
}

const RANK: Record<WhatsAppDeliveryStatus, number> = { sent: 0, delivered: 1, read: 2, failed: -1 };

/** Statuses only move forward: a late "delivered" never downgrades "read", and "failed" never overrides a read. */
export function shouldAdvance(current: string | null, next: WhatsAppDeliveryStatus): boolean {
  if (next === 'failed') return current !== 'read';
  const currentRank = current && current in RANK ? RANK[current as WhatsAppDeliveryStatus] : -1;
  return RANK[next] > currentRank;
}
