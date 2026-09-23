export interface AppConfig {
  env: string;
  port: number;
  apiPrefix: string;
  corsOrigin: string;
  database: {
    url: string;
  };
  redis: {
    host: string;
    port: number;
    password?: string;
    db: number;
  };
  jwt: {
    accessSecret: string;
    accessExpiresIn: string;
    refreshSecret: string;
    refreshExpiresIn: string;
  };
  throttle: {
    ttl: number;
    limit: number;
  };
  llm: {
    openai: {
      apiKey?: string;
      baseUrl?: string;
      model?: string;
    };
  };
  embedding: {
    enabled: boolean;
    provider: string;
    baseUrl?: string;
    apiKey?: string;
    model?: string;
  };
  memory: {
    retrievalLimit: number;
    contextBudgetChars: number;
    summaryMessageThreshold: number;
  };
  crossScopeEnabled: boolean;
  encryptionKey?: string;
  /**
   * Phase D: the IANA timezone used to phrase the "current time" reference
   * given to the LLM (see TimeContextService) when no real per-user
   * timezone exists yet — User has no `timezone` column today. Documented,
   * explicit, and configurable (never a silent/arbitrary choice by the
   * model itself) — see AGENTS Phase D correction §1.
   */
  defaultTimezone: string;
  documents: {
    storageDir: string;
    maxUploadBytes: number;
  };
  whatsapp: {
    webhookSecret?: string;
  };
}

export default (): { app: AppConfig } => ({
  app: {
    env: process.env.NODE_ENV ?? 'development',
    port: parseInt(process.env.PORT ?? '3000', 10),
    apiPrefix: process.env.API_PREFIX ?? 'api/v1',
    corsOrigin: process.env.CORS_ORIGIN ?? 'http://localhost:3000',
    database: {
      url: process.env.DATABASE_URL ?? '',
    },
    redis: {
      host: process.env.REDIS_HOST ?? 'localhost',
      port: parseInt(process.env.REDIS_PORT ?? '6379', 10),
      password: process.env.REDIS_PASSWORD || undefined,
      // Separate logical DB per environment (Redis supports 0-15) so a
      // locally-running dev server and the e2e test suite never share BullMQ
      // queues on the same Redis instance — discovered as a real cross-worker
      // race condition while validating Phase C (see docs/ARCHITECTURE.md).
      db: parseInt(process.env.REDIS_DB ?? '0', 10),
    },
    jwt: {
      accessSecret: process.env.JWT_ACCESS_SECRET ?? '',
      accessExpiresIn: process.env.JWT_ACCESS_EXPIRES_IN ?? '15m',
      refreshSecret: process.env.JWT_REFRESH_SECRET ?? '',
      refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN ?? '7d',
    },
    throttle: {
      ttl: parseInt(process.env.THROTTLE_TTL ?? '60', 10),
      limit: parseInt(process.env.THROTTLE_LIMIT ?? '100', 10),
    },
    llm: {
      openai: {
        apiKey: process.env.OPENAI_API_KEY || undefined,
        baseUrl: process.env.OPENAI_BASE_URL || undefined,
        model: process.env.OPENAI_MODEL || undefined,
      },
    },
    embedding: {
      enabled: process.env.MORA_EMBEDDING_ENABLED === 'true',
      provider: process.env.MORA_EMBEDDING_PROVIDER || 'openai-compatible',
      baseUrl: process.env.MORA_EMBEDDING_BASE_URL || undefined,
      apiKey: process.env.MORA_EMBEDDING_API_KEY || undefined,
      model: process.env.MORA_EMBEDDING_MODEL || undefined,
    },
    memory: {
      retrievalLimit: parseInt(process.env.MORA_MEMORY_RETRIEVAL_LIMIT ?? '8', 10),
      contextBudgetChars: parseInt(process.env.MORA_CONTEXT_BUDGET_CHARS ?? '6000', 10),
      summaryMessageThreshold: parseInt(
        process.env.MORA_SUMMARY_MESSAGE_THRESHOLD ?? '20',
        10,
      ),
    },
    // Phase B security default: hybrid requests never combine personal +
    // professional context/actions unless this is explicitly turned on.
    crossScopeEnabled: process.env.MORA_CROSS_SCOPE_ENABLED === 'true',
    // Phase C.5: master key for AiProvider secret encryption (AES-256-GCM).
    // Optional at boot (the app must still start with none configured — see
    // AGENTS §1) but required the moment any code tries to encrypt/decrypt a
    // provider's API key; SecretEncryptionService.validateEncryptionKey()
    // throws a clear error at that point instead.
    encryptionKey: process.env.MORA_ENCRYPTION_KEY || undefined,
    // No per-user timezone stored today (User has no `timezone` field) — UTC
    // is the explicit, documented default rather than a silent choice left
    // to the model. Configurable per deployment via MORA_DEFAULT_TIMEZONE.
    defaultTimezone: process.env.MORA_DEFAULT_TIMEZONE || 'UTC',
    // Phase E: local document storage (S3/MinIO-ready via DocumentStorageInterface).
    documents: {
      storageDir: process.env.MORA_DOCUMENTS_STORAGE_DIR || './storage/documents',
      maxUploadBytes: parseInt(process.env.MORA_DOCUMENTS_MAX_UPLOAD_BYTES ?? '26214400', 10), // 25MB default
    },
    // Phase E: shared-secret verification for the Evolution API webhook
    // (AGENTS §27) — absent by design until an operator configures a real
    // WhatsApp account; the webhook then accepts any request unauthenticated
    // in dev, which is why this MUST be set before exposing the endpoint
    // publicly.
    whatsapp: {
      webhookSecret: process.env.MORA_WHATSAPP_WEBHOOK_SECRET || undefined,
    },
  },
});
