import { plainToInstance } from 'class-transformer';
import { getMetadataStorage, validateSync } from 'class-validator';
import type { ToolValidationResult } from './tool.types.js';

/**
 * Internal argument contract (post-review correction — root cause below):
 * by the time a tool call reaches `validateWithDto`, `raw` is ALWAYS
 * already a plain JSON object, never a string/null/undefined. The
 * normalization boundary is the OpenAI-compatible adapter's
 * `parseToolArguments()` (see openai-compatible-chat.adapter.ts): it
 * JSON.parses the provider's raw `arguments` string and falls back to `{}`
 * for anything that isn't valid JSON or isn't an object — including a
 * missing `arguments` field, an empty string, whitespace, or literal
 * `"null"`. `validateWithDto` itself never re-parses a string; a caller
 * that somehow hands it something other than an object/null is a
 * programming error, not a provider quirk, and is rejected outright.
 *
 * ROOT CAUSE of the "empty-schema tool sometimes rejected with
 * invalid_arguments" bug: class-validator's `validateSync()` special-cases
 * a target class with ZERO registered `@Is...()` decorators — instead of
 * reporting "no errors" for a genuinely empty schema, it returns a single
 * synthetic error ("an unknown value was passed to the validate function"),
 * regardless of whether the input object itself was empty or not. Every
 * `MoraTool` whose input DTO has no decorated properties at all (e.g.
 * `list_pending_actions`, `get_profile_facts`, `logistiga_get_summary`)
 * was affected — never tools with at least one real `@IsOptional()`/
 * `@IsString()` etc. field, which validate normally.
 *
 * FIX: detect a target class with no registered validation metadata via
 * `getMetadataStorage()` (the same registry `validateSync` itself reads)
 * BEFORE calling into class-validator. For such a class: an empty object
 * `{}` (the only value the normalized `raw` can be here besides a
 * populated object) is valid by definition — there is nothing to check —
 * and is returned as-is. Backend security is never weakened: a tool that
 * genuinely requires arguments always has at least one decorated property,
 * so it always takes the unchanged, strict `validateSync` path below;
 * extra/unexpected keys on a truly argument-less tool are still rejected
 * (a tool declaring zero parameters that receives any key back is not
 * "friendly provider noise" to silently accept, it's unexpected input).
 */
export function validateWithDto<T extends object>(cls: new () => T, raw: unknown): ToolValidationResult<T> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { valid: false, errors: ['input must be a JSON object'] };
  }

  const hasAnyValidatedProperty =
    getMetadataStorage().getTargetValidationMetadatas(cls, cls.name, false, false).length > 0;

  if (!hasAnyValidatedProperty) {
    if (Object.keys(raw).length === 0) {
      return { valid: true, value: plainToInstance(cls, raw) };
    }
    return {
      valid: false,
      errors: ['This tool takes no parameters, but arguments were provided'],
    };
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
