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
  },
});
