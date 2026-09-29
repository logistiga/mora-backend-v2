import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ESSENTIAL_SCOPE, ESSENTIAL_SPACE, ProfileFactsService } from './profile-facts.service.js';

function buildService() {
  const prismaMock = {
    profileFact: {
      findMany: vi.fn(async () => []),
      findFirst: vi.fn(async () => null as { id: string; value: string; confidence: number } | null),
      create: vi.fn(async (args: { data: Record<string, unknown> }) => ({ id: 'new-fact', ...args.data })),
      update: vi.fn(async (args: { data: Record<string, unknown> }) => ({ id: 'updated', ...args.data })),
    },
  };
  const configServiceMock = { get: vi.fn(() => 12) };
  const service = new ProfileFactsService(prismaMock as never, configServiceMock as never);
  return { service, prismaMock };
}

describe('ProfileFactsService — Essential User Profile', () => {
  let ctx: ReturnType<typeof buildService>;

  beforeEach(() => {
    ctx = buildService();
  });

  describe('getEssential', () => {
    it('queries only the reserved essential scope/space, bounded and active', async () => {
      await ctx.service.getEssential('u1');

      expect(ctx.prismaMock.profileFact.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: 'u1', scope: ESSENTIAL_SCOPE, space: ESSENTIAL_SPACE, status: 'active' },
          take: 12,
        }),
      );
    });
  });

  describe('upsertEssential', () => {
    it('creates a new essential fact when no active fact with that key exists', async () => {
      ctx.prismaMock.profileFact.findFirst.mockResolvedValue(null);

      await ctx.service.upsertEssential('u1', {
        key: 'language_behavior',
        value: "Répond dans la langue de l'utilisateur",
        confidence: 0.9,
        source: 'extraction',
        sourceId: 'msg1',
      });

      expect(ctx.prismaMock.profileFact.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            userId: 'u1',
            scope: ESSENTIAL_SCOPE,
            space: ESSENTIAL_SPACE,
            key: 'language_behavior',
          }),
        }),
      );
      expect(ctx.prismaMock.profileFact.update).not.toHaveBeenCalled();
    });

    it('supersedes (never overwrites in place) an existing fact with the same key but a different value (test E fixture)', async () => {
      ctx.prismaMock.profileFact.findFirst.mockResolvedValue({
        id: 'old-fact',
        value: 'Réponds toujours en français',
        confidence: 0.7,
      });

      await ctx.service.upsertEssential('u1', {
        key: 'language_behavior',
        value: "Répond dans la langue utilisée par l'utilisateur",
        confidence: 0.9,
        source: 'extraction',
        sourceId: 'msg2',
      });

      expect(ctx.prismaMock.profileFact.create).toHaveBeenCalledOnce();
      expect(ctx.prismaMock.profileFact.update).toHaveBeenCalledWith({
        where: { id: 'old-fact' },
        data: { status: 'superseded', supersededById: 'new-fact' },
      });
    });

    it('bumps confidence instead of superseding when the exact same value is re-taught', async () => {
      ctx.prismaMock.profileFact.findFirst.mockResolvedValue({
        id: 'existing-fact',
        value: "Répond dans la langue utilisée par l'utilisateur",
        confidence: 0.6,
      });

      await ctx.service.upsertEssential('u1', {
        key: 'language_behavior',
        value: "répond dans la langue utilisée par l'utilisateur", // same, different case
        confidence: 0.9,
        source: 'extraction',
      });

      expect(ctx.prismaMock.profileFact.create).not.toHaveBeenCalled();
      expect(ctx.prismaMock.profileFact.update).toHaveBeenCalledWith({
        where: { id: 'existing-fact' },
        data: { confidence: 0.9 },
      });
    });
  });

  describe('archiveEssentialByKey', () => {
    it('archives (never deletes) the active fact matching the key', async () => {
      ctx.prismaMock.profileFact.findFirst.mockResolvedValue({ id: 'fact-1', value: 'x', confidence: 0.8 });

      await ctx.service.archiveEssentialByKey('u1', 'language_behavior');

      expect(ctx.prismaMock.profileFact.update).toHaveBeenCalledWith({
        where: { id: 'fact-1' },
        data: { status: 'archived' },
      });
    });

    it('returns null when there is nothing active to archive', async () => {
      ctx.prismaMock.profileFact.findFirst.mockResolvedValue(null);
      const result = await ctx.service.archiveEssentialByKey('u1', 'unknown_key');
      expect(result).toBeNull();
      expect(ctx.prismaMock.profileFact.update).not.toHaveBeenCalled();
    });
  });
});
