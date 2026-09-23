import { Injectable } from '@nestjs/common';
import type { BusinessDataConnectorInterface, BusinessSearchResult, BusinessEntitySummary } from './business-connector.interface.js';
import { PISTON_FIXTURES } from './fixtures/piston.fixtures.js';

const MAX_RESULTS = 20;

@Injectable()
export class PistonConnector implements BusinessDataConnectorInterface {
  readonly system = 'piston';

  async search(query: string, entityType?: string): Promise<BusinessSearchResult> {
    const q = query.toLowerCase();
    const matched = PISTON_FIXTURES.filter(
      (e) => (!entityType || e.type === entityType) && (e.label.toLowerCase().includes(q) || JSON.stringify(e.fields).toLowerCase().includes(q)),
    );
    return { results: matched.slice(0, MAX_RESULTS), totalMatched: matched.length, truncated: matched.length > MAX_RESULTS };
  }

  async getEntity(id: string): Promise<BusinessEntitySummary | null> {
    return PISTON_FIXTURES.find((e) => e.id === id) ?? null;
  }

  async getSummary() {
    const entityCounts: Record<string, number> = {};
    for (const e of PISTON_FIXTURES) entityCounts[e.type] = (entityCounts[e.type] ?? 0) + 1;
    return { entityCounts, lastSyncAt: null };
  }
}
