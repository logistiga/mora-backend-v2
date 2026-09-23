import type { BusinessEntitySummary } from '../business-connector.interface.js';

/** Synthetic fixture data — NOT real Piston records (same rationale as logistiga.fixtures.ts). */
export const PISTON_FIXTURES: BusinessEntitySummary[] = [
  { id: 'ps-project-1', type: 'project', label: 'Projet Fictif Rotor', fields: { status: 'active', budget: 50000 } },
  { id: 'ps-supplier-1', type: 'supplier', label: 'Fournisseur Fictif X', fields: { rating: 4.2 } },
];
