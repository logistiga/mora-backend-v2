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
  },
});
