export interface BusinessEntitySummary {
  id: string;
  type: string;
  label: string;
  fields: Record<string, unknown>;
}

export interface BusinessSearchResult {
  results: BusinessEntitySummary[];
  totalMatched: number;
  truncated: boolean;
}

/**
 * READ-ONLY by construction (AGENTS Phase E §44/§45): the interface itself
 * exposes no write method at all — there is no `create`/`update`/`delete`
 * to accidentally call. A future real connector backed by a dedicated
 * SELECT-only SQL role would still only ever need to implement these three
 * methods; nothing elsewhere in the codebase can bypass this contract to
 * reach LogistiGA/Piston with a raw query (AGENTS §46: "Pas de SQL
 * arbitraire LLM").
 *
 * TEST STATUS (AGENTS §47/§58, honestly reported): no real LogistiGA/Piston
 * database schema or credentials were available in this session. Both
 * concrete connectors below are FIXTURE-based (small, clearly-labeled
 * synthetic datasets) — real schema inspection and a real read-only DB
 * role are prerequisites for a genuine connector, explicitly deferred.
 */
export interface BusinessDataConnectorInterface {
  readonly system: string;

  search(query: string, entityType?: string): Promise<BusinessSearchResult>;
  getEntity(id: string): Promise<BusinessEntitySummary | null>;
  getSummary(): Promise<{ entityCounts: Record<string, number>; lastSyncAt: string | null }>;
}
