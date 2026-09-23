import type { BusinessEntitySummary } from '../business-connector.interface.js';

/**
 * Synthetic, clearly-fictional fixture data — NOT real LogistiGA records
 * (AGENTS Phase E §47: "Ne devine pas le schéma... créer fixtures
 * contractuelles"). Standing in for a real read-only DB connection until
 * real schema access is authorized.
 */
export const LOGISTIGA_FIXTURES: BusinessEntitySummary[] = [
  { id: 'lg-client-1', type: 'client', label: 'Client Fictif A', fields: { balanceDue: 1200, currency: 'EUR', lastInvoiceAt: '2026-08-01' } },
  { id: 'lg-client-2', type: 'client', label: 'Client Fictif B', fields: { balanceDue: 0, currency: 'EUR', lastInvoiceAt: '2026-09-10' } },
  { id: 'lg-shipment-1', type: 'shipment', label: 'Expédition #FIC-001', fields: { status: 'in_transit', origin: 'Anvers', destination: 'Casablanca' } },
];
