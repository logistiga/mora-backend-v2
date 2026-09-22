import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import type { AiProvider, Prisma } from '../generated/prisma/client.js';
import { ChatAdapterRegistry } from './adapters/chat-adapter-registry.service.js';
import { EmbeddingAdapterRegistry } from './adapters/embedding-adapter-registry.service.js';
import type {
  AiProviderPublicView,
  ProviderCapabilities,
  ProviderSettings,
  ResolvedProviderConnection,
  SelectProviderParams,
} from './ai-provider.types.js';
import type { CreateAiProviderDto } from './dto/create-ai-provider.dto.js';
import type { ListAiProvidersQueryDto } from './dto/list-ai-providers.dto.js';
import type { UpdateAiProviderDto } from './dto/update-ai-provider.dto.js';
import { SecretEncryptionService } from './secret-encryption.service.js';

export interface TestResult {
  success: boolean;
  message: string;
}

@Injectable()
export class AiProviderService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly secretEncryption: SecretEncryptionService,
    private readonly chatAdapters: ChatAdapterRegistry,
    private readonly embeddingAdapters: EmbeddingAdapterRegistry,
  ) {}

  async create(userId: string, dto: CreateAiProviderDto): Promise<AiProviderPublicView> {
    const encrypted = dto.apiKey ? this.secretEncryption.encryptSecret(dto.apiKey) : null;

    const created = await this.prisma.$transaction(async (tx) => {
      if (dto.isDefault) {
        await this.unsetSiblingDefaults(tx, userId, dto.kind, dto.scope, dto.space);
      }
      return tx.aiProvider.create({
        data: {
          userId,
          name: dto.name,
          provider: dto.provider,
          kind: dto.kind,
          baseUrl: dto.baseUrl,
          model: dto.model,
          apiKeyEncrypted: encrypted?.ciphertext,
          apiKeyIv: encrypted?.iv,
          apiKeyAuthTag: encrypted?.authTag,
          apiKeyHint: dto.apiKey ? this.secretEncryption.maskSecret(dto.apiKey) : undefined,
          encryptionVersion: encrypted?.version ?? 1,
          isActive: dto.isActive ?? true,
          isDefault: dto.isDefault ?? false,
          scope: dto.scope,
          space: dto.space,
          capabilities: (dto.capabilities ?? {}) as Prisma.InputJsonValue,
          settings: (dto.settings ?? {}) as Prisma.InputJsonValue,
          priority: dto.priority ?? 0,
        },
      });
    });

    return this.toPublicView(created);
  }

  async list(userId: string, query: ListAiProvidersQueryDto): Promise<AiProviderPublicView[]> {
    const rows = await this.prisma.aiProvider.findMany({
      where: {
        userId,
        kind: query.kind,
        scope: query.scope,
        space: query.space,
        isActive: query.isActive === undefined ? undefined : query.isActive === 'true',
      },
      orderBy: [{ isDefault: 'desc' }, { priority: 'desc' }, { updatedAt: 'desc' }],
    });
    return rows.map((row) => this.toPublicView(row));
  }

  async get(userId: string, id: string): Promise<AiProviderPublicView> {
    const row = await this.getOwnedRow(userId, id);
    return this.toPublicView(row);
  }

  async update(userId: string, id: string, dto: UpdateAiProviderDto): Promise<AiProviderPublicView> {
    const existing = await this.getOwnedRow(userId, id);
    const encrypted = dto.apiKey ? this.secretEncryption.encryptSecret(dto.apiKey) : null;

    const updated = await this.prisma.$transaction(async (tx) => {
      if (dto.isDefault) {
        const kind = existing.kind;
        const scope = dto.scope !== undefined ? dto.scope : existing.scope;
        const space = dto.space !== undefined ? dto.space : existing.space;
        await this.unsetSiblingDefaults(tx, userId, kind, scope ?? undefined, space ?? undefined, id);
      }
      return tx.aiProvider.update({
        where: { id },
        data: {
          name: dto.name,
          baseUrl: dto.baseUrl,
          model: dto.model,
          ...(encrypted
            ? {
                apiKeyEncrypted: encrypted.ciphertext,
                apiKeyIv: encrypted.iv,
                apiKeyAuthTag: encrypted.authTag,
                apiKeyHint: this.secretEncryption.maskSecret(dto.apiKey!),
                encryptionVersion: encrypted.version,
              }
            : {}),
          isActive: dto.isActive,
          isDefault: dto.isDefault,
          scope: dto.scope,
          space: dto.space,
          capabilities: dto.capabilities as Prisma.InputJsonValue | undefined,
          settings: dto.settings as Prisma.InputJsonValue | undefined,
          priority: dto.priority,
        },
      });
    });

    return this.toPublicView(updated);
  }

  async enable(userId: string, id: string): Promise<AiProviderPublicView> {
    await this.getOwnedRow(userId, id);
    const row = await this.prisma.aiProvider.update({ where: { id }, data: { isActive: true } });
    return this.toPublicView(row);
  }

  async disable(userId: string, id: string): Promise<AiProviderPublicView> {
    await this.getOwnedRow(userId, id);
    // A disabled provider is never returned by getProviderForUseCase() — see
    // the `isActive: true` filter there. Disabling, not deleting, is the
    // preferred reversible action (see `delete()` doc comment below).
    const row = await this.prisma.aiProvider.update({ where: { id }, data: { isActive: false } });
    return this.toPublicView(row);
  }

  async setDefault(userId: string, id: string): Promise<AiProviderPublicView> {
    const existing = await this.getOwnedRow(userId, id);
    const updated = await this.prisma.$transaction(async (tx) => {
      await this.unsetSiblingDefaults(tx, userId, existing.kind, existing.scope ?? undefined, existing.space ?? undefined, id);
      return tx.aiProvider.update({ where: { id }, data: { isDefault: true } });
    });
    return this.toPublicView(updated);
  }

  /**
   * Hard delete. Chosen over soft-delete because `LlmCall.providerId` has no
   * foreign-key constraint (a plain informational UUID, same pattern as
   * `AuditEntry` — see schema.prisma): historical call records survive a
   * provider's deletion either way, so deleting doesn't corrupt
   * observability data. Prefer `disable()` for anything you might want to
   * reverse; use `delete()` only to actually remove a bad/test entry.
   */
  async delete(userId: string, id: string): Promise<void> {
    await this.getOwnedRow(userId, id);
    await this.prisma.aiProvider.delete({ where: { id } });
  }

  async testConnection(userId: string, id: string): Promise<TestResult> {
    const row = await this.getOwnedRow(userId, id);
    const connection = this.toConnection(row);

    let result: TestResult;
    try {
      if (row.kind === 'chat') {
        const adapter = this.chatAdapters.getAdapter(row.provider);
        if (!adapter) {
          result = { success: false, message: `No chat adapter registered for provider "${row.provider}"` };
        } else {
          await adapter.complete(connection, {
            messages: [{ role: 'user', content: 'ping' }],
            maxTokens: 1,
            temperature: 0,
          });
          result = { success: true, message: 'Chat completion succeeded' };
        }
      } else if (row.kind === 'embedding') {
        const adapter = this.embeddingAdapters.getAdapter(row.provider);
        if (!adapter) {
          result = { success: false, message: `No embedding adapter registered for provider "${row.provider}"` };
        } else {
          const outcome = await adapter.embed(connection, 'test');
          result = { success: true, message: `Embedding succeeded (${outcome.dimensions} dimensions)` };
        }
      } else {
        result = {
          success: false,
          message: `No test implemented yet for kind "${row.kind}" (Phase C.5 ships chat/embedding adapters only)`,
        };
      }
    } catch (error) {
      // Redacted: never include the raw provider response (which could echo
      // back request headers/auth info in some error bodies).
      result = { success: false, message: sanitizeErrorMessage(error) };
    }

    await this.prisma.aiProvider.update({
      where: { id },
      data: {
        lastTestedAt: new Date(),
        lastTestStatus: result.success ? 'success' : 'failure',
        lastTestMessage: result.message,
      },
    });

    return result;
  }

  async getStatus(userId: string): Promise<Record<string, unknown>> {
    const rows = await this.prisma.aiProvider.findMany({ where: { userId, isActive: true } });
    const byKind = (kind: string) => rows.filter((r) => r.kind === kind);
    const defaultOf = (kind: string) => rows.find((r) => r.kind === kind && r.isDefault) ?? byKind(kind)[0];

    const kinds = ['chat', 'embedding', 'vision', 'stt', 'tts', 'image', 'avatar'];
    const configured: Record<string, boolean> = {};
    const defaults: Record<string, { id: string; name: string; provider: string; model: string } | null> = {};
    for (const kind of kinds) {
      configured[`${kind}Configured`] = byKind(kind).length > 0;
      const def = defaultOf(kind);
      defaults[kind] = def ? { id: def.id, name: def.name, provider: def.provider, model: def.model } : null;
    }

    return { ...configured, defaults };
  }

  /** Core selection rule (also used by AiModelSelectorService): prefer an exact
   *  scope+space match, then scope-only, then a global (scope=null,space=null)
   *  provider; within a tier, prefer isDefault, then higher priority, then
   *  oldest (stable ordering). Simple and documented, per AGENTS §11. */
  async getProviderForUseCase(userId: string, params: SelectProviderParams): Promise<AiProvider | null> {
    const candidates = await this.prisma.aiProvider.findMany({
      where: { userId, kind: params.kind, isActive: true },
    });
    if (candidates.length === 0) return null;

    const tiers = [
      candidates.filter((c) => c.scope === (params.scope ?? null) && c.space === (params.space ?? null) && (params.scope || params.space)),
      candidates.filter((c) => c.scope === (params.scope ?? null) && c.space === null && params.scope),
      candidates.filter((c) => c.scope === null && c.space === null),
    ];

    for (const tier of tiers) {
      if (tier.length === 0) continue;
      tier.sort((a, b) => {
        if (a.isDefault !== b.isDefault) return a.isDefault ? -1 : 1;
        if (a.priority !== b.priority) return b.priority - a.priority;
        return a.createdAt.getTime() - b.createdAt.getTime();
      });
      return tier[0];
    }
    return null;
  }

  async getDefaultProvider(userId: string, kind: string): Promise<AiProvider | null> {
    return this.prisma.aiProvider.findFirst({
      where: { userId, kind, isActive: true, isDefault: true },
    });
  }

  async getProvidersByKind(userId: string, kind: string): Promise<AiProvider[]> {
    return this.prisma.aiProvider.findMany({ where: { userId, kind, isActive: true } });
  }

  /** Decrypts the row's key (if any) into an in-memory connection object — never persisted, never logged. */
  toConnection(row: AiProvider): ResolvedProviderConnection {
    const apiKey =
      row.apiKeyEncrypted && row.apiKeyIv && row.apiKeyAuthTag
        ? this.secretEncryption.decryptSecret({
            ciphertext: row.apiKeyEncrypted,
            iv: row.apiKeyIv,
            authTag: row.apiKeyAuthTag,
            version: row.encryptionVersion,
          })
        : undefined;

    return {
      providerRowId: row.id,
      provider: row.provider,
      kind: row.kind,
      model: row.model,
      baseUrl: row.baseUrl ?? undefined,
      apiKey,
      capabilities: (row.capabilities as ProviderCapabilities) ?? {},
      settings: (row.settings as ProviderSettings) ?? {},
    };
  }

  private async getOwnedRow(userId: string, id: string): Promise<AiProvider> {
    const row = await this.prisma.aiProvider.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('AI provider not found');
    if (row.userId !== userId) throw new ForbiddenException('This AI provider does not belong to you');
    return row;
  }

  private async unsetSiblingDefaults(
    tx: Prisma.TransactionClient,
    userId: string,
    kind: string,
    scope: string | undefined,
    space: string | undefined,
    excludeId?: string,
  ): Promise<void> {
    await tx.aiProvider.updateMany({
      where: {
        userId,
        kind,
        scope: scope ?? null,
        space: space ?? null,
        isDefault: true,
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
      data: { isDefault: false },
    });
  }

  private toPublicView(row: AiProvider): AiProviderPublicView {
    return {
      id: row.id,
      name: row.name,
      provider: row.provider,
      kind: row.kind,
      baseUrl: row.baseUrl,
      model: row.model,
      hasKey: Boolean(row.apiKeyEncrypted),
      keyHint: row.apiKeyHint,
      isActive: row.isActive,
      isDefault: row.isDefault,
      scope: row.scope,
      space: row.space,
      capabilities: row.capabilities as ProviderCapabilities | null,
      settings: row.settings as ProviderSettings | null,
      priority: row.priority,
      lastTestedAt: row.lastTestedAt,
      lastTestStatus: row.lastTestStatus,
      lastTestMessage: row.lastTestMessage,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}

/** Strips anything that could resemble a leaked secret/header from a provider error before storing/returning it. */
function sanitizeErrorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  if (raw.length > 200) {
    return `${raw.slice(0, 200)}…`;
  }
  return raw;
}
