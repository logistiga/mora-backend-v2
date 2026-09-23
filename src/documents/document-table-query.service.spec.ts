import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DocumentTableQueryService } from './document-table-query.service.js';

function buildService() {
  const prismaMock = {
    documentTable: { findUnique: vi.fn() },
    documentTableRow: { findMany: vi.fn() },
  };
  const service = new DocumentTableQueryService(prismaMock as never);
  return { service, prismaMock };
}

const table = {
  id: 't1',
  columns: [{ name: 'Client' }, { name: 'Impayes' }],
  document: { userId: 'u1' },
};

const rows = [
  { rowIndex: 0, data: { Client: 'A', Impayes: '100' } },
  { rowIndex: 1, data: { Client: 'B', Impayes: '500' } },
  { rowIndex: 2, data: { Client: 'A', Impayes: '50' } },
];

describe('DocumentTableQueryService', () => {
  let ctx: ReturnType<typeof buildService>;

  beforeEach(() => {
    ctx = buildService();
  });

  it('throws NotFoundException for an unknown table', async () => {
    ctx.prismaMock.documentTable.findUnique.mockResolvedValue(null);
    await expect(ctx.service.query('u1', { tableId: 'missing' })).rejects.toThrow(NotFoundException);
  });

  it('throws ForbiddenException for a table belonging to another user', async () => {
    ctx.prismaMock.documentTable.findUnique.mockResolvedValue({ ...table, document: { userId: 'someone-else' } });
    await expect(ctx.service.query('u1', { tableId: 't1' })).rejects.toThrow(ForbiddenException);
  });

  it('rejects an unknown column — never queries against an arbitrary column name', async () => {
    ctx.prismaMock.documentTable.findUnique.mockResolvedValue(table);
    await expect(ctx.service.query('u1', { tableId: 't1', groupBy: 'NotAColumn' })).rejects.toThrow(/Unknown column/);
  });

  it('groups and sums correctly (the "which client has the most unpaid" case)', async () => {
    ctx.prismaMock.documentTable.findUnique.mockResolvedValue(table);
    ctx.prismaMock.documentTableRow.findMany.mockResolvedValue(rows);

    const result = await ctx.service.query('u1', {
      tableId: 't1',
      groupBy: 'Client',
      aggregateColumn: 'Impayes',
      aggregateFn: 'sum',
      sortDir: 'desc',
    });

    expect(result.rows[0]).toEqual({ group: 'B', value: 500 }); // sortDir desc: highest first
    expect(result.rows[1]).toEqual({ group: 'A', value: 150 }); // A = 100 + 50 (grouped correctly)
  });

  it('sorts descending by aggregate value (top result first)', async () => {
    ctx.prismaMock.documentTable.findUnique.mockResolvedValue(table);
    ctx.prismaMock.documentTableRow.findMany.mockResolvedValue(rows);

    const result = await ctx.service.query('u1', {
      tableId: 't1',
      groupBy: 'Client',
      aggregateColumn: 'Impayes',
      aggregateFn: 'sum',
      sortDir: 'desc',
    });

    expect(result.rows[0].group).toBe('B'); // 500 > 150
    expect(result.rows[0].value).toBe(500);
  });

  it('applies an optional filter before aggregating', async () => {
    ctx.prismaMock.documentTable.findUnique.mockResolvedValue(table);
    ctx.prismaMock.documentTableRow.findMany.mockResolvedValue(rows);

    const result = await ctx.service.query('u1', {
      tableId: 't1',
      filterColumn: 'Client',
      filterValue: 'A',
      aggregateColumn: 'Impayes',
      aggregateFn: 'count',
    });

    expect(result.rows[0].value).toBe(2);
  });

  it('caps result rows and reports truncation from a bounded scan', async () => {
    ctx.prismaMock.documentTable.findUnique.mockResolvedValue(table);
    ctx.prismaMock.documentTableRow.findMany.mockResolvedValue(
      Array.from({ length: 20000 }, (_, i) => ({ rowIndex: i, data: { Client: `C${i}`, Impayes: '1' } })),
    );

    const result = await ctx.service.query('u1', { tableId: 't1', groupBy: 'Client' });
    expect(result.truncated).toBe(true);
    expect(result.rows.length).toBeLessThanOrEqual(100);
  });
});
