import { describe, expect, it } from 'vitest';
import { validate } from './env.validation.js';

const validEnv = {
  NODE_ENV: 'test',
  PORT: '3000',
  API_PREFIX: 'api/v1',
  CORS_ORIGIN: 'http://localhost:3000',
  POSTGRES_USER: 'mora',
  POSTGRES_PASSWORD: 'secret',
  POSTGRES_DB: 'mora',
  POSTGRES_HOST: 'localhost',
  POSTGRES_PORT: '5432',
  DATABASE_URL: 'postgresql://mora:secret@localhost:5432/mora',
  REDIS_HOST: 'localhost',
  REDIS_PORT: '6379',
  JWT_ACCESS_SECRET: 'a'.repeat(32),
  JWT_ACCESS_EXPIRES_IN: '15m',
  JWT_REFRESH_SECRET: 'b'.repeat(32),
  JWT_REFRESH_EXPIRES_IN: '7d',
  THROTTLE_TTL: '60',
  THROTTLE_LIMIT: '100',
};

describe('env.validation', () => {
  it('accepts a fully populated, valid environment', () => {
    const result = validate({ ...validEnv });
    expect(result.PORT).toBe(3000);
    expect(result.NODE_ENV).toBe('test');
  });

  it('rejects an unknown NODE_ENV value', () => {
    expect(() => validate({ ...validEnv, NODE_ENV: 'staging' })).toThrow(
      /Invalid environment configuration/,
    );
  });

  it('rejects a JWT access secret shorter than 32 characters', () => {
    expect(() => validate({ ...validEnv, JWT_ACCESS_SECRET: 'too-short' })).toThrow(
      /JWT_ACCESS_SECRET must be at least 32 characters/,
    );
  });

  it('rejects a missing DATABASE_URL', () => {
    const { DATABASE_URL: _drop, ...rest } = validEnv;
    expect(() => validate(rest)).toThrow(/Invalid environment configuration/);
  });
});
