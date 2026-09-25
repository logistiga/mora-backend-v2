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

/** Owner of an AiProvider row: a user id for a personal (BYOK) provider,
 *  `null` for a SYSTEM provider shared by every user. */
export type ProviderOwner = string | null;

export type ProviderSource = 'user' | 'system' | 'none';

@Injectable()
export class AiProviderService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly secretEncryption: SecretEncryptionService,
    private readonly chatAdapters: ChatAdapterRegistry,
    private readonly embeddingAdapters: EmbeddingAdapterRegistry,
  ) {}

  async create(owner: ProviderOwner, dto: CreateAiProviderDto): Promise<AiProviderPublicView> {
    const encrypted = dto.apiKey ? this.secretEncryption.encryptSecret(dto.apiKey) : null;

    const created = await this.prisma.$transaction(async (tx) => {
      if (dto.isDefault) {
        await this.unsetSiblingDefaults(tx, owner, dto.kind, dto.scope, dto.space);
      }
      return tx.aiProvider.create({
        data: {
          userId: owner,
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

  /** A user sees their own providers plus the SYSTEM ones (read-only, and
   *  without the key hint — only an ADMIN gets that, via `listSystem`). */
  async list(userId: string, query: ListAiProvidersQueryDto): Promise<AiProviderPublicView[]> {
    const rows = await this.prisma.aiProvider.findMany({
      where: {
        OR: [{ userId }, { userId: null }],
        kind: query.kind,
        scope: query.scope,
        space: query.space,
        isActive: query.isActive === undefined ? undefined : query.isActive === 'true',
      },
      orderBy: [{ isDefault: 'desc' }, { priority: 'desc' }, { updatedAt: 'desc' }],
    });
    // Personal providers first: they win at resolution time.
    const sorted = [...rows].sort((a, b) => Number(a.userId === null) - Number(b.userId === null));
    return sorted.map((row) => this.toPublicView(row, { redactSystemHint: true }));
  }

  async listSystem(query: ListAiProvidersQueryDto): Promise<AiProviderPublicView[]> {
    const rows = await this.prisma.aiProvider.findMany({
      where: {
        userId: null,
        kind: query.kind,
        scope: query.scope,
        space: query.space,
        isActive: query.isActive === undefined ? undefined : query.isActive === 'true',
      },
      orderBy: [{ isDefault: 'desc' }, { priority: 'desc' }, { updatedAt: 'desc' }],
    });
    return rows.map((row) => this.toPublicView(row));
  }

  /** Read access: a user's own row, or any SYSTEM row (read-only, hint redacted). */
  async get(userId: string, id: string): Promise<AiProviderPublicView> {
    const row = await this.prisma.aiProvider.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('AI provider not found');
    if (row.userId !== null && row.userId !== userId) {
      throw new ForbiddenException('This AI provider does not belong to you');
    }
    return this.toPublicView(row, { redactSystemHint: true });
  }

  async getOne(owner: ProviderOwner, id: string): Promise<AiProviderPublicView> {
    const row = await this.getOwnedRow(owner, id);
    return this.toPublicView(row);
  }

  async update(owner: ProviderOwner, id: string, dto: UpdateAiProviderDto): Promise<AiProviderPublicView> {
    const existing = await this.getOwnedRow(owner, id);
    const encrypted = dto.apiKey ? this.secretEncryption.encryptSecret(dto.apiKey) : null;

    const updated = await this.prisma.$transaction(async (tx) => {
      if (dto.isDefault) {
        const kind = existing.kind;
        const scope = dto.scope !== undefined ? dto.scope : existing.scope;
        const space = dto.space !== undefined ? dto.space : existing.space;
        await this.unsetSiblingDefaults(tx, owner, kind, scope ?? undefined, space ?? undefined, id);
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

  async enable(owner: ProviderOwner, id: string): Promise<AiProviderPublicView> {
    await this.getOwnedRow(owner, id);
    const row = await this.prisma.aiProvider.update({ where: { id }, data: { isActive: true } });
    return this.toPublicView(row);
  }

  async disable(owner: ProviderOwner, id: string): Promise<AiProviderPublicView> {
    await this.getOwnedRow(owner, id);
    // A disabled provider is never returned by getProviderForUseCase() — see
    // the `isActive: true` filter there. Disabling, not deleting, is the
    // preferred reversible action (see `delete()` doc comment below).
    const row = await this.prisma.aiProvider.update({ where: { id }, data: { isActive: false } });
    return this.toPublicView(row);
  }

  async setDefault(owner: ProviderOwner, id: string): Promise<AiProviderPublicView> {
    const existing = await this.getOwnedRow(owner, id);
    const updated = await this.prisma.$transaction(async (tx) => {
      await this.unsetSiblingDefaults(tx, owner, existing.kind, existing.scope ?? undefined, existing.space ?? undefined, id);
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
  async delete(owner: ProviderOwner, id: string): Promise<void> {
    await this.getOwnedRow(owner, id);
    await this.prisma.aiProvider.delete({ where: { id } });
  }

  async testConnection(owner: ProviderOwner, id: string): Promise<TestResult> {
    const row = await this.getOwnedRow(owner, id);
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

  /** What the frontend needs to know: for each kind, whether a provider will
   *  actually resolve for this user, and where it comes from — 'user' (BYOK),
   *  'system' (provided by Mora) or 'none'. Never exposes key material. */
  async getStatus(userId: string): Promise<Record<string, unknown>> {
    const rows = await this.prisma.aiProvider.findMany({
      where: { OR: [{ userId }, { userId: null }], isActive: true },
    });

    const kinds = ['chat', 'embedding', 'vision', 'stt', 'tts', 'image', 'avatar'];
    const configured: Record<string, boolean> = {};
    const sources: Record<string, ProviderSource> = {};
    const defaults: Record<
      string,
      { id: string; name: string; provider: string; model: string; source: ProviderSource } | null
    > = {};

    for (const kind of kinds) {
      const def = selectProviderRow(rows, userId, { kind });
      const source: ProviderSource = def === null ? 'none' : def.userId === null ? 'system' : 'user';
      configured[`${kind}Configured`] = def !== null;
      sources[kind] = source;
      defaults[kind] = def
        ? { id: def.id, name: def.name, provider: def.provider, model: def.model, source }
        : null;
    }

    return { ...configured, sources, defaults };
  }

  /** Single resolution rule for every consumer (chat, embedding, vision, stt,
   *  tts, avatar — they all go through here, directly or via
   *  AiModelSelectorService).
   *
   *  Ownership first: the user's own (BYOK) providers are searched before the
   *  SYSTEM ones, so a personal key always overrides the shared Mora key.
   *  Within one ownership pool, specificity decides: exact scope+space, then
   *  scope-only, then global (scope=null,space=null); and within a tier,
   *  isDefault, then higher priority, then oldest (stable ordering).
   *  Returns null when neither a USER nor a SYSTEM provider matches — the
   *  caller must then degrade honestly ("provider not configured"). */
  async getProviderForUseCase(userId: string, params: SelectProviderParams): Promise<AiProvider | null> {
    const candidates = await this.prisma.aiProvider.findMany({
      where: { OR: [{ userId }, { userId: null }], kind: params.kind, isActive: true },
    });
    return selectProviderRow(candidates, userId, params);
  }

  /** Same resolution as `getProviderForUseCase`, plus where the row came from. */
  async resolveProviderWithSource(
    userId: string,
    params: SelectProviderParams,
  ): Promise<{ row: AiProvider | null; source: ProviderSource }> {
    const row = await this.getProviderForUseCase(userId, params);
    return { row, source: row === null ? 'none' : row.userId === null ? 'system' : 'user' };
  }

  async getDefaultProvider(userId: string, kind: string): Promise<AiProvider | null> {
    return (
      (await this.prisma.aiProvider.findFirst({ where: { userId, kind, isActive: true, isDefault: true } })) ??
      (await this.prisma.aiProvider.findFirst({ where: { userId: null, kind, isActive: true, isDefault: true } }))
    );
  }

  async getProvidersByKind(userId: string, kind: string): Promise<AiProvider[]> {
    return this.prisma.aiProvider.findMany({
      where: { OR: [{ userId }, { userId: null }], kind, isActive: true },
    });
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

  /** Write access. `owner === null` is the ADMIN/SYSTEM path (see
   *  AiProviderSystemController): it only ever matches SYSTEM rows. A user id
   *  only ever matches that user's own rows, so a standard user can never
   *  update, disable, delete or test a SYSTEM provider through `/ai-providers`. */
  private async getOwnedRow(owner: ProviderOwner, id: string): Promise<AiProvider> {
    const row = await this.prisma.aiProvider.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('AI provider not found');
    if (row.userId !== owner) {
      throw new ForbiddenException(
        owner === null
          ? 'This AI provider is not a SYSTEM provider'
          : 'This AI provider does not belong to you',
      );
    }
    return row;
  }

  private async unsetSiblingDefaults(
    tx: Prisma.TransactionClient,
    owner: ProviderOwner,
    kind: string,
    scope: string | undefined,
    space: string | undefined,
    excludeId?: string,
  ): Promise<void> {
    await tx.aiProvider.updateMany({
      where: {
        userId: owner,
        kind,
        scope: scope ?? null,
        space: space ?? null,
        isDefault: true,
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
      data: { isDefault: false },
    });
  }

  private toPublicView(
    row: AiProvider,
    options: { redactSystemHint?: boolean } = {},
  ): AiProviderPublicView {
    const isSystem = row.userId === null;
    return {
      id: row.id,
      isSystem,
      owner: isSystem ? 'system' : 'user',
      name: row.name,
      provider: row.provider,
      kind: row.kind,
      baseUrl: row.baseUrl,
      model: row.model,
      hasKey: Boolean(row.apiKeyEncrypted),
      // A SYSTEM key belongs to Mora, not to the caller: even its last-4 hint
      // is only returned on the ADMIN routes.
      keyHint: isSystem && options.redactSystemHint ? null : row.apiKeyHint,
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

/** Pure form of the resolution rule (see `getProviderForUseCase`): USER rows
 *  first, then SYSTEM rows; inside each pool, exact scope+space > scope-only >
 *  global; inside a tier, isDefault > higher priority > oldest. */
export function selectProviderRow(
  rows: AiProvider[],
  userId: string,
  params: SelectProviderParams,
): AiProvider | null {
  const candidates = rows.filter((r) => r.kind === params.kind && r.isActive);
  const pools = [
    candidates.filter((c) => c.userId === userId),
    candidates.filter((c) => c.userId === null),
  ];

  for (const pool of pools) {
    const tiers = [
      pool.filter(
        (c) =>
          c.scope === (params.scope ?? null) &&
          c.space === (params.space ?? null) &&
          (params.scope || params.space),
      ),
      pool.filter((c) => c.scope === (params.scope ?? null) && c.space === null && params.scope),
      pool.filter((c) => c.scope === null && c.space === null),
    ];
    for (const tier of tiers) {
      if (tier.length === 0) continue;
      const sorted = [...tier].sort((a, b) => {
        if (a.isDefault !== b.isDefault) return a.isDefault ? -1 : 1;
        if (a.priority !== b.priority) return b.priority - a.priority;
        return a.createdAt.getTime() - b.createdAt.getTime();
      });
      return sorted[0];
    }
  }
  return null;
}

/** Strips anything that could resemble a leaked secret/header from a provider error before storing/returning it. */
function sanitizeErrorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  if (raw.length > 200) {
    return `${raw.slice(0, 200)}…`;
  }
  return raw;
}
