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
