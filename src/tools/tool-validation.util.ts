import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import type { ToolValidationResult } from './tool.types.js';

/**
 * The real argument authority (AGENTS Phase D §31): the fact that the LLM
 * produced `raw` never makes it trusted. Reuses the same class-validator
 * machinery NestJS's ValidationPipe uses for REST DTOs, applied manually
 * here since tool-call arguments never pass through Nest's HTTP pipeline.
 */
export function validateWithDto<T extends object>(cls: new () => T, raw: unknown): ToolValidationResult<T> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { valid: false, errors: ['input must be a JSON object'] };
  }

  const instance = plainToInstance(cls, raw);
  const errors = validateSync(instance as object, { whitelist: true, forbidNonWhitelisted: true });
  if (errors.length > 0) {
    return {
      valid: false,
      errors: errors.flatMap((e) => Object.values(e.constraints ?? { unknown: 'invalid value' })),
    };
  }
  return { valid: true, value: instance };
}
