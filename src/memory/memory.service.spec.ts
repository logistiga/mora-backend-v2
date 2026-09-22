import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryService } from './memory.service.js';

function buildService() {
  const prismaMock = {
    memory: {
      create: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
  };
  const memoryQueueMock = { enqueueEmbedding: vi.fn() };

  const service = new MemoryService(prismaMock as never, memoryQueueMock as never);
  return { service, prismaMock, memoryQueueMock };
}

describe('MemoryService', () => {
  let ctx: ReturnType<typeof buildService>;

  beforeEach(() => {
    ctx = buildService();
  });

  it('create() persists the memory and enqueues an embedding job', async () => {
    ctx.prismaMock.memory.create.mockResolvedValue({ id: 'm1', userId: 'u1' });

    const result = await ctx.service.create('u1', {
      scope: 'personal',
      space: 'personal',
      kind: 'preference',
      content: 'Aime les réponses courtes',
    });

    expect(result.id).toBe('m1');
    expect(ctx.memoryQueueMock.enqueueEmbedding).toHaveBeenCalledWith({
      memoryId: 'm1',
      userId: 'u1',
    });
  });

  it('getById() throws NotFoundException for an unknown id', async () => {
    ctx.prismaMock.memory.findUnique.mockResolvedValue(null);
    await expect(ctx.service.getById('u1', 'missing')).rejects.toThrow(NotFoundException);
  });

  it('getById() throws ForbiddenException for another user\'s memory', async () => {
    ctx.prismaMock.memory.findUnique.mockResolvedValue({ id: 'm1', userId: 'someone-else' });
    await expect(ctx.service.getById('u1', 'm1')).rejects.toThrow(ForbiddenException);
  });

  it('getById() returns the memory when it belongs to the caller', async () => {
    ctx.prismaMock.memory.findUnique.mockResolvedValue({ id: 'm1', userId: 'u1' });
    const result = await ctx.service.getById('u1', 'm1');
    expect(result.id).toBe('m1');
  });

  it('archive() sets status to archived after an ownership check', async () => {
    ctx.prismaMock.memory.findUnique.mockResolvedValue({ id: 'm1', userId: 'u1' });
    ctx.prismaMock.memory.update.mockResolvedValue({ id: 'm1', status: 'archived' });

    const result = await ctx.service.archive('u1', 'm1');

    expect(ctx.prismaMock.memory.update).toHaveBeenCalledWith({
      where: { id: 'm1' },
      data: { status: 'archived' },
    });
    expect(result.status).toBe('archived');
  });

  it('archive() refuses to archive another user\'s memory', async () => {
    ctx.prismaMock.memory.findUnique.mockResolvedValue({ id: 'm1', userId: 'other' });
    await expect(ctx.service.archive('u1', 'm1')).rejects.toThrow(ForbiddenException);
  });

  it('supersede() marks the old memory superseded and creates a new active one', async () => {
    ctx.prismaMock.memory.findUnique.mockResolvedValue({
      id: 'old1',
      userId: 'u1',
      importance: 0.6,
      confidence: 0.7,
    });
    ctx.prismaMock.memory.create.mockResolvedValue({ id: 'new1', userId: 'u1', status: 'active' });
    ctx.prismaMock.memory.update.mockResolvedValue({
      id: 'old1',
      status: 'superseded',
      supersededById: 'new1',
    });

    const result = await ctx.service.supersede('u1', 'old1', {
      scope: 'personal',
      space: 'personal',
      kind: 'preference',
      content: 'Nouvelle préférence',
    });

    expect(ctx.prismaMock.memory.update).toHaveBeenCalledWith({
      where: { id: 'old1' },
      data: { status: 'superseded', supersededById: 'new1' },
    });
    expect(result.old.status).toBe('superseded');
    expect(result.replacement.id).toBe('new1');
    expect(ctx.memoryQueueMock.enqueueEmbedding).toHaveBeenCalledWith({
      memoryId: 'new1',
      userId: 'u1',
    });
  });

  it('list() always filters by the caller\'s userId and defaults to active status', async () => {
    ctx.prismaMock.memory.findMany.mockResolvedValue([]);

    await ctx.service.list('u1', {});

    expect(ctx.prismaMock.memory.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ userId: 'u1', status: 'active' }) }),
    );
  });

  it('findSupersessionCandidate() picks the most similar active memory of the same kind', async () => {
    ctx.prismaMock.memory.findMany.mockResolvedValue([
      { id: 'a', content: 'Aime le café le matin' },
      { id: 'b', content: 'Préfère recevoir ses rappels de façon courte et directe' },
    ]);

    const result = await ctx.service.findSupersessionCandidate(
      'u1',
      'personal',
      'personal',
      'preference',
      'Préfère recevoir ses notifications de façon courte et directe',
    );

    expect(result?.id).toBe('b');
  });

  it('findSupersessionCandidate() returns null when nothing is similar enough', async () => {
    ctx.prismaMock.memory.findMany.mockResolvedValue([{ id: 'a', content: 'Aime le café le matin' }]);

    const result = await ctx.service.findSupersessionCandidate(
      'u1',
      'personal',
      'personal',
      'preference',
      'Le projet Piston doit livrer vendredi',
    );

    expect(result).toBeNull();
  });
});
