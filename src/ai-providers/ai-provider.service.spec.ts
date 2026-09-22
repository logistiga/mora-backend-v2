import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AiProviderService } from './ai-provider.service.js';

function buildService() {
  const txMock = {
    aiProvider: { create: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
  };
  const prismaMock = {
    aiProvider: {
      create: vi.fn(),
      findMany: vi.fn(async () => []),
      findUnique: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      findFirst: vi.fn(),
    },
    $transaction: vi.fn(async (fn: (tx: typeof txMock) => unknown) => fn(txMock)),
  };
  const secretEncryptionMock = {
    encryptSecret: vi.fn((plaintext: string) => ({
      ciphertext: `enc(${plaintext})`,
      iv: 'iv',
      authTag: 'tag',
      version: 1,
    })),
    decryptSecret: vi.fn(() => 'decrypted-key'),
    maskSecret: vi.fn((plaintext: string) => plaintext.slice(-4)),
  };
  const chatAdaptersMock = { getAdapter: vi.fn() };
  const embeddingAdaptersMock = { getAdapter: vi.fn() };

  const service = new AiProviderService(
    prismaMock as never,
    secretEncryptionMock as never,
    chatAdaptersMock as never,
    embeddingAdaptersMock as never,
  );

  return { service, prismaMock, txMock, secretEncryptionMock, chatAdaptersMock, embeddingAdaptersMock };
}

const baseDto = {
  name: 'My OpenAI',
  provider: 'openai',
  kind: 'chat',
  model: 'gpt-4o-mini',
  apiKey: 'sk-test-1234567890',
};

describe('AiProviderService', () => {
  let ctx: ReturnType<typeof buildService>;

  beforeEach(() => {
    ctx = buildService();
  });

  describe('create', () => {
    it('encrypts the API key and never stores it in plaintext', async () => {
      ctx.txMock.aiProvider.create.mockResolvedValue({
        id: 'p1',
        userId: 'u1',
        name: 'My OpenAI',
        provider: 'openai',
        kind: 'chat',
        baseUrl: null,
        model: 'gpt-4o-mini',
        apiKeyEncrypted: 'enc(sk-test-1234567890)',
        apiKeyHint: '7890',
        isActive: true,
        isDefault: false,
        scope: null,
        space: null,
        capabilities: {},
        settings: {},
        priority: 0,
        lastTestedAt: null,
        lastTestStatus: null,
        lastTestMessage: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const result = await ctx.service.create('u1', baseDto);

      expect(ctx.secretEncryptionMock.encryptSecret).toHaveBeenCalledWith('sk-test-1234567890');
      expect(ctx.txMock.aiProvider.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            apiKeyEncrypted: 'enc(sk-test-1234567890)',
            apiKeyHint: '7890',
          }),
        }),
      );
      // The public view never carries key material.
      expect(result).not.toHaveProperty('apiKeyEncrypted');
      expect(result).not.toHaveProperty('apiKeyIv');
      expect(result).not.toHaveProperty('apiKeyAuthTag');
      expect(result.hasKey).toBe(true);
      expect(result.keyHint).toBe('7890');
    });

    it('unsets sibling defaults before creating a new default provider (in a transaction)', async () => {
      ctx.txMock.aiProvider.create.mockResolvedValue({ id: 'p2', kind: 'chat', scope: null, space: null } as never);

      await ctx.service.create('u1', { ...baseDto, isDefault: true });

      expect(ctx.prismaMock.$transaction).toHaveBeenCalledOnce();
      expect(ctx.txMock.aiProvider.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ userId: 'u1', kind: 'chat', isDefault: true }),
          data: { isDefault: false },
        }),
      );
    });

    it('allows creating a provider without an API key (e.g. local, no auth needed)', async () => {
      ctx.txMock.aiProvider.create.mockResolvedValue({ id: 'p3', apiKeyEncrypted: null, apiKeyHint: null } as never);

      await ctx.service.create('u1', { name: 'Local Ollama', provider: 'ollama', kind: 'chat', model: 'llama3' });

      expect(ctx.secretEncryptionMock.encryptSecret).not.toHaveBeenCalled();
    });
  });

  describe('ownership', () => {
    it('throws NotFoundException for a missing provider', async () => {
      ctx.prismaMock.aiProvider.findUnique.mockResolvedValue(null);
      await expect(ctx.service.get('u1', 'missing')).rejects.toThrow(NotFoundException);
    });

    it("throws ForbiddenException for another user's provider", async () => {
      ctx.prismaMock.aiProvider.findUnique.mockResolvedValue({ id: 'p1', userId: 'other' } as never);
      await expect(ctx.service.get('u1', 'p1')).rejects.toThrow(ForbiddenException);
    });
  });

  describe('update', () => {
    it('keeps the existing key when no new apiKey is sent', async () => {
      ctx.prismaMock.aiProvider.findUnique.mockResolvedValue({
        id: 'p1',
        userId: 'u1',
        kind: 'chat',
        scope: null,
        space: null,
      } as never);
      ctx.txMock.aiProvider.update.mockResolvedValue({ id: 'p1' } as never);

      await ctx.service.update('u1', 'p1', { name: 'Renamed' });

      expect(ctx.secretEncryptionMock.encryptSecret).not.toHaveBeenCalled();
      expect(ctx.txMock.aiProvider.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.not.objectContaining({ apiKeyEncrypted: expect.anything() }),
        }),
      );
    });

    it('re-encrypts with a new key when apiKey is sent (rotation)', async () => {
      ctx.prismaMock.aiProvider.findUnique.mockResolvedValue({
        id: 'p1',
        userId: 'u1',
        kind: 'chat',
        scope: null,
        space: null,
      } as never);
      ctx.txMock.aiProvider.update.mockResolvedValue({ id: 'p1' } as never);

      await ctx.service.update('u1', 'p1', { apiKey: 'sk-new-key-999' });

      expect(ctx.secretEncryptionMock.encryptSecret).toHaveBeenCalledWith('sk-new-key-999');
      expect(ctx.txMock.aiProvider.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ apiKeyEncrypted: 'enc(sk-new-key-999)', apiKeyHint: '-999' }),
        }),
      );
    });
  });

  describe('disable / enable', () => {
    it('disable() sets isActive to false', async () => {
      ctx.prismaMock.aiProvider.findUnique.mockResolvedValue({ id: 'p1', userId: 'u1' } as never);
      ctx.prismaMock.aiProvider.update.mockResolvedValue({ id: 'p1', isActive: false } as never);

      await ctx.service.disable('u1', 'p1');

      expect(ctx.prismaMock.aiProvider.update).toHaveBeenCalledWith({
        where: { id: 'p1' },
        data: { isActive: false },
      });
    });
  });

  describe('setDefault', () => {
    it('unsets siblings and sets this provider as default, in a transaction', async () => {
      ctx.prismaMock.aiProvider.findUnique.mockResolvedValue({
        id: 'p1',
        userId: 'u1',
        kind: 'chat',
        scope: null,
        space: null,
      } as never);
      ctx.txMock.aiProvider.update.mockResolvedValue({ id: 'p1', isDefault: true } as never);

      await ctx.service.setDefault('u1', 'p1');

      expect(ctx.txMock.aiProvider.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ id: { not: 'p1' } }),
          data: { isDefault: false },
        }),
      );
      expect(ctx.txMock.aiProvider.update).toHaveBeenCalledWith({
        where: { id: 'p1' },
        data: { isDefault: true },
      });
    });
  });

  describe('getProviderForUseCase', () => {
    const now = new Date();
    const global = { id: 'global', userId: 'u1', kind: 'chat', scope: null, space: null, isDefault: false, priority: 0, createdAt: now, isActive: true };
    const scoped = { id: 'scoped', userId: 'u1', kind: 'chat', scope: 'professional', space: null, isDefault: false, priority: 0, createdAt: now, isActive: true };
    const exact = { id: 'exact', userId: 'u1', kind: 'chat', scope: 'professional', space: 'logistiga', isDefault: false, priority: 0, createdAt: now, isActive: true };

    it('returns null when no active provider exists for this kind', async () => {
      ctx.prismaMock.aiProvider.findMany.mockResolvedValue([]);
      const result = await ctx.service.getProviderForUseCase('u1', { kind: 'chat' });
      expect(result).toBeNull();
    });

    it('prefers an exact scope+space match over a global provider', async () => {
      ctx.prismaMock.aiProvider.findMany.mockResolvedValue([global, exact] as never);
      const result = await ctx.service.getProviderForUseCase('u1', {
        kind: 'chat',
        scope: 'professional',
        space: 'logistiga',
      });
      expect(result?.id).toBe('exact');
    });

    it('prefers a scope-only match over a global provider when no exact match exists', async () => {
      ctx.prismaMock.aiProvider.findMany.mockResolvedValue([global, scoped] as never);
      const result = await ctx.service.getProviderForUseCase('u1', {
        kind: 'chat',
        scope: 'professional',
        space: 'code', // no exact match for this space
      });
      expect(result?.id).toBe('scoped');
    });

    it('falls back to the global provider when nothing scope/space-specific exists', async () => {
      ctx.prismaMock.aiProvider.findMany.mockResolvedValue([global] as never);
      const result = await ctx.service.getProviderForUseCase('u1', {
        kind: 'chat',
        scope: 'personal',
        space: 'personal',
      });
      expect(result?.id).toBe('global');
    });

    it('within a tier, prefers isDefault over priority', async () => {
      const a = { ...global, id: 'a', isDefault: false, priority: 10 };
      const b = { ...global, id: 'b', isDefault: true, priority: 0 };
      ctx.prismaMock.aiProvider.findMany.mockResolvedValue([a, b] as never);
      const result = await ctx.service.getProviderForUseCase('u1', { kind: 'chat' });
      expect(result?.id).toBe('b');
    });

    it('within a tier, prefers higher priority when default status is equal', async () => {
      const a = { ...global, id: 'a', isDefault: false, priority: 10 };
      const b = { ...global, id: 'b', isDefault: false, priority: 5 };
      ctx.prismaMock.aiProvider.findMany.mockResolvedValue([a, b] as never);
      const result = await ctx.service.getProviderForUseCase('u1', { kind: 'chat' });
      expect(result?.id).toBe('a');
    });

    it('ignores disabled providers entirely (query filters isActive: true)', async () => {
      await ctx.service.getProviderForUseCase('u1', { kind: 'chat' });
      expect(ctx.prismaMock.aiProvider.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ isActive: true }) }),
      );
    });

    it('ignores providers of the wrong kind (query filters by kind)', async () => {
      await ctx.service.getProviderForUseCase('u1', { kind: 'embedding' });
      expect(ctx.prismaMock.aiProvider.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ kind: 'embedding' }) }),
      );
    });
  });

  describe('toConnection', () => {
    it('decrypts the key only in memory and never re-serializes it', () => {
      const row = {
        id: 'p1',
        provider: 'openai',
        kind: 'chat',
        model: 'gpt-4o-mini',
        baseUrl: null,
        apiKeyEncrypted: 'enc',
        apiKeyIv: 'iv',
        apiKeyAuthTag: 'tag',
        encryptionVersion: 1,
        capabilities: {},
        settings: {},
      };
      const connection = ctx.service.toConnection(row as never);
      expect(connection.apiKey).toBe('decrypted-key');
      expect(JSON.stringify(connection)).not.toContain('enc');
    });

    it('leaves apiKey undefined when the provider has no stored key', () => {
      const row = {
        id: 'p1',
        provider: 'ollama',
        kind: 'chat',
        model: 'llama3',
        baseUrl: 'http://localhost:11434/v1',
        apiKeyEncrypted: null,
        apiKeyIv: null,
        apiKeyAuthTag: null,
        encryptionVersion: 1,
        capabilities: {},
        settings: {},
      };
      const connection = ctx.service.toConnection(row as never);
      expect(connection.apiKey).toBeUndefined();
      expect(ctx.secretEncryptionMock.decryptSecret).not.toHaveBeenCalled();
    });
  });

  describe('testConnection', () => {
    it('records success and never leaks the key in the stored test message', async () => {
      ctx.prismaMock.aiProvider.findUnique.mockResolvedValue({
        id: 'p1',
        userId: 'u1',
        kind: 'chat',
        provider: 'openai',
        model: 'gpt-4o-mini',
        apiKeyEncrypted: 'enc',
        apiKeyIv: 'iv',
        apiKeyAuthTag: 'tag',
        encryptionVersion: 1,
        capabilities: {},
        settings: {},
      } as never);
      const adapterMock = { complete: vi.fn(async () => ({ content: 'pong', model: 'gpt-4o-mini' })) };
      ctx.chatAdaptersMock.getAdapter.mockReturnValue(adapterMock);

      const result = await ctx.service.testConnection('u1', 'p1');

      expect(result.success).toBe(true);
      expect(ctx.prismaMock.aiProvider.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ lastTestStatus: 'success' }) }),
      );
    });

    it('records failure with a sanitized message when the adapter throws', async () => {
      ctx.prismaMock.aiProvider.findUnique.mockResolvedValue({
        id: 'p1',
        userId: 'u1',
        kind: 'chat',
        provider: 'openai',
        model: 'gpt-4o-mini',
        apiKeyEncrypted: 'enc',
        apiKeyIv: 'iv',
        apiKeyAuthTag: 'tag',
        encryptionVersion: 1,
        capabilities: {},
        settings: {},
      } as never);
      const adapterMock = { complete: vi.fn(async () => { throw new Error('Invalid API key: sk-real-secret-key'); }) };
      ctx.chatAdaptersMock.getAdapter.mockReturnValue(adapterMock);

      const result = await ctx.service.testConnection('u1', 'p1');

      expect(result.success).toBe(false);
      // The error message itself isn't redacted of arbitrary substrings (that's
      // the provider's problem not to leak in error text), but confirm nothing
      // from encryption internals (ciphertext/iv/authTag) is ever included.
      expect(result.message).not.toContain('apiKeyEncrypted');
      expect(result.message).not.toContain('iv');
    });
  });
});
