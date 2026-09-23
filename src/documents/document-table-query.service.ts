import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';

export type AggregateFn = 'sum' | 'count' | 'avg' | 'max' | 'min';

export interface TableQuerySpec {
  tableId: string;
  groupBy?: string;
  aggregateColumn?: string;
  aggregateFn?: AggregateFn;
  filterColumn?: string;
  filterValue?: string;
  sortDir?: 'asc' | 'desc';
  limit?: number;
}

export interface TableQueryResultRow {
  group: string | null;
  value: number | null;
}

const MAX_ROWS_SCANNED = 20000; // bounded — Phase E never loads an unbounded table into memory
const MAX_RESULT_ROWS = 100;

/**
 * The ONLY way a tool/LLM can ask an analytical question of a document
 * table (AGENTS Phase E §15/§16): a small, closed, allowlisted query spec
 * (group-by + aggregate + optional filter + sort/limit), never raw SQL the
 * model produced. Every column name in the spec is validated against the
 * table's own recorded `columns` before touching any data — an unknown
 * column is a validation error, never a query against arbitrary data.
 */
@Injectable()
export class DocumentTableQueryService {
  constructor(private readonly prisma: PrismaService) {}

  async query(userId: string, spec: TableQuerySpec): Promise<{ columns: string[]; rows: TableQueryResultRow[]; scannedRows: number; truncated: boolean }> {
    const table = await this.prisma.documentTable.findUnique({
      where: { id: spec.tableId },
      include: { document: { select: { userId: true } } },
    });
    if (!table) throw new NotFoundException('Table not found');
    if (table.document.userId !== userId) throw new ForbiddenException('This table does not belong to you');

    const knownColumns = new Set((table.columns as { name: string }[]).map((c) => c.name));
    for (const col of [spec.groupBy, spec.aggregateColumn, spec.filterColumn].filter(Boolean) as string[]) {
      if (!knownColumns.has(col)) {
        throw new Error(`Unknown column "${col}" — not part of this table's real columns`);
      }
    }

    const rows = await this.prisma.documentTableRow.findMany({
      where: { tableId: spec.tableId },
      orderBy: { rowIndex: 'asc' },
      take: MAX_ROWS_SCANNED,
    });

    const filtered = spec.filterColumn
      ? rows.filter((r) => String((r.data as Record<string, unknown>)[spec.filterColumn!] ?? '') === spec.filterValue)
      : rows;

    const grouped = new Map<string | null, number[]>();
    for (const row of filtered) {
      const data = row.data as Record<string, unknown>;
      const groupKey = spec.groupBy ? String(data[spec.groupBy] ?? 'N/A') : null;
      const value = spec.aggregateColumn ? toNumber(data[spec.aggregateColumn]) : 1;
      if (!grouped.has(groupKey)) grouped.set(groupKey, []);
      if (value !== null) grouped.get(groupKey)!.push(value);
    }

    let result: TableQueryResultRow[] = [...grouped.entries()].map(([group, values]) => ({
      group,
      value: aggregate(values, spec.aggregateFn ?? 'sum'),
    }));

    result.sort((a, b) => {
      const av = a.value ?? 0;
      const bv = b.value ?? 0;
      return spec.sortDir === 'asc' ? av - bv : bv - av;
    });

    const limit = Math.min(spec.limit ?? 20, MAX_RESULT_ROWS);
    result = result.slice(0, limit);

    return {
      columns: [...knownColumns],
      rows: result,
      scannedRows: rows.length,
      truncated: rows.length === MAX_ROWS_SCANNED,
    };
  }
}

function toNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') {
    const cleaned = value.replace(/[^0-9.,-]/g, '').replace(',', '.');
    const parsed = Number.parseFloat(cleaned);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function aggregate(values: number[], fn: AggregateFn): number | null {
  if (values.length === 0) return fn === 'count' ? 0 : null;
  switch (fn) {
    case 'sum':
      return values.reduce((a, b) => a + b, 0);
    case 'count':
      return values.length;
    case 'avg':
      return values.reduce((a, b) => a + b, 0) / values.length;
    case 'max':
      return Math.max(...values);
    case 'min':
      return Math.min(...values);
  }
}
