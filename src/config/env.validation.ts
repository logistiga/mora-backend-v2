import { plainToInstance } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
  MinLength,
  validateSync,
} from 'class-validator';

export enum Environment {
  Development = 'development',
  Test = 'test',
  Production = 'production',
}

/**
 * Declarative contract for every environment variable the app relies on.
 * `validate()` below runs this at bootstrap time and crashes fast (before
 * Nest even starts listening) if anything is missing or malformed.
 */
export class EnvironmentVariables {
  @IsIn([Environment.Development, Environment.Test, Environment.Production])
  NODE_ENV: Environment = Environment.Development;

  @IsInt()
  @Min(1)
  @Max(65535)
  PORT: number = 3000;

  @IsString()
  API_PREFIX: string = 'api/v1';

  @IsString()
  CORS_ORIGIN: string = 'http://localhost:3000';

  @IsOptional()
  @IsString()
  MORA_ALLOWED_ORIGINS?: string;

  @IsOptional()
  @IsString()
  MORA_APP_ENV?: string;

  @IsOptional()
  @IsString()
  MORA_BUILD_VERSION?: string;

  @IsOptional()
  @IsString()
  MORA_GIT_COMMIT?: string;

  @IsString()
  POSTGRES_USER: string;

  @IsString()
  POSTGRES_PASSWORD: string;

  @IsString()
  POSTGRES_DB: string;

  @IsString()
  POSTGRES_HOST: string;

  @IsInt()
  POSTGRES_PORT: number;

  // Not a URL-scheme string prisma/pg drivers can always parse with @IsUrl,
  // so it's kept as a plain non-empty string check instead.
  @IsString()
  @MinLength(10)
  DATABASE_URL: string;

  @IsString()
  REDIS_HOST: string;

  @IsInt()
  REDIS_PORT: number;

  @IsOptional()
  @IsString()
  REDIS_PASSWORD?: string;

  @IsOptional()
  @IsInt()
  REDIS_DB?: number;

  @IsString()
  @MinLength(32, {
    message: 'JWT_ACCESS_SECRET must be at least 32 characters long',
  })
  JWT_ACCESS_SECRET: string;

  @IsString()
  JWT_ACCESS_EXPIRES_IN: string = '15m';

  @IsString()
  @MinLength(32, {
    message: 'JWT_REFRESH_SECRET must be at least 32 characters long',
  })
  JWT_REFRESH_SECRET: string;

  @IsString()
  JWT_REFRESH_EXPIRES_IN: string = '7d';

  @IsInt()
  THROTTLE_TTL: number = 60;

  @IsInt()
  THROTTLE_LIMIT: number = 100;

  // Optional: LLM provider config. Absent by design in most environments —
  // the app must keep working (LlmService degrades gracefully) without it.
  @IsOptional()
  @IsString()
  OPENAI_API_KEY?: string;

  @IsOptional()
  @IsString()
  OPENAI_BASE_URL?: string;

  @IsOptional()
  @IsString()
  OPENAI_MODEL?: string;

  @IsOptional()
  @IsIn(['true', 'false'])
  MORA_CROSS_SCOPE_ENABLED?: string;

  // Optional: embedding provider config (Phase C). Absent by design in most
  // environments — EmbeddingService degrades to a documented "not enabled"
  // outcome and MemoryRetrievalService falls back to text search.
  @IsOptional()
  @IsIn(['true', 'false'])
  MORA_EMBEDDING_ENABLED?: string;

  @IsOptional()
  @IsString()
  MORA_EMBEDDING_PROVIDER?: string;

  @IsOptional()
  @IsString()
  MORA_EMBEDDING_BASE_URL?: string;

  @IsOptional()
  @IsString()
  MORA_EMBEDDING_API_KEY?: string;

  @IsOptional()
  @IsString()
  MORA_EMBEDDING_MODEL?: string;

  @IsOptional()
  @IsInt()
  MORA_MEMORY_RETRIEVAL_LIMIT?: number;

  @IsOptional()
  @IsInt()
  MORA_CONTEXT_BUDGET_CHARS?: number;

  @IsOptional()
  @IsInt()
  MORA_SUMMARY_MESSAGE_THRESHOLD?: number;

  // Optional: master key for AiProvider secret encryption (Phase C.5). Absent
  // by design in most environments until the operator adds a real AI
  // provider — SecretEncryptionService rejects encrypt/decrypt calls with a
  // clear error when it's missing, but the app itself still boots fine.
  @IsOptional()
  @IsString()
  MORA_ENCRYPTION_KEY?: string;

  // Optional: IANA timezone used to phrase the "current time" reference the
  // LLM is given for resolving relative date expressions (Phase D — see
  // TimeContextService). Defaults to 'UTC' when absent; documented,
  // explicit, never a silent per-request guess.
  @IsOptional()
  @IsString()
  MORA_DEFAULT_TIMEZONE?: string;

  // Optional: Phase E local document storage.
  @IsOptional()
  @IsString()
  MORA_DOCUMENTS_STORAGE_DIR?: string;

  @IsOptional()
  @IsInt()
  MORA_DOCUMENTS_MAX_UPLOAD_BYTES?: number;

  @IsOptional()
  @IsString()
  MORA_WHATSAPP_WEBHOOK_SECRET?: string;
}

export function validate(config: Record<string, unknown>): EnvironmentVariables {
  const validatedConfig = plainToInstance(EnvironmentVariables, config, {
    enableImplicitConversion: true,
  });

  const errors = validateSync(validatedConfig, {
    skipMissingProperties: false,
  });

  if (errors.length > 0) {
    const formatted = errors
      .map((error) => Object.values(error.constraints ?? {}).join(', '))
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${formatted}`);
  }

  return validatedConfig;
}
