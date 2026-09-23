import { IsIn, IsOptional, IsString, MinLength } from 'class-validator';
import { describe, expect, it } from 'vitest';
import { validateWithDto } from './tool-validation.util.js';

/** Mirrors a real empty-schema tool input (e.g. list_pending_actions, get_profile_facts, logistiga_get_summary). */
class EmptySchemaInput {}

/** Mirrors a real tool with an optional field only (e.g. list_tasks). */
class OptionalFieldInput {
  @IsOptional()
  @IsIn(['a', 'b'])
  status?: string;
}

/** Mirrors a real tool with a required field (e.g. get_task). */
class RequiredFieldInput {
  @IsString()
  @MinLength(1)
  taskId: string;
}

describe('validateWithDto — post-review correction (empty-schema tools)', () => {
  // A. empty-schema tool + {}
  it('A. accepts {} for a tool that declares no parameters', () => {
    const result = validateWithDto(EmptySchemaInput, {});
    expect(result.valid).toBe(true);
  });

  // B/C/D are normalized upstream by the OpenAI adapter's parseToolArguments
  // (missing/""/whitespace/"null" all become {} before reaching here) — see
  // openai-compatible-chat.adapter.spec.ts for that normalization boundary.
  // Verified directly here too, since validateWithDto must handle {} either way.
  it('B/C/D. accepts the normalized {} regardless of what the provider originally sent', () => {
    expect(validateWithDto(EmptySchemaInput, {}).valid).toBe(true);
  });

  // E. tool with required arguments + {} → must still be rejected
  it('E. still rejects {} for a tool that requires a real argument (security never weakened)', () => {
    const result = validateWithDto(RequiredFieldInput, {});
    expect(result.valid).toBe(false);
  });

  // F. malformed JSON is handled upstream (adapter never lets it reach here as
  // a string) — validateWithDto's own non-object guard is the last line of
  // defense if it ever did.
  it('F. rejects a non-object (e.g. a raw string that slipped through) with a controlled error, never a crash', () => {
    const result = validateWithDto(EmptySchemaInput, 'not an object');
    expect(result.valid).toBe(false);
    expect(result.errors?.[0]).toMatch(/JSON object/);
  });

  // G. unexpected/dangerous extra arguments on an empty-schema tool
  it('G. rejects unexpected extra arguments on a tool declaring zero parameters', () => {
    const result = validateWithDto(EmptySchemaInput, { random_string: '', malicious: 'rm -rf /' });
    expect(result.valid).toBe(false);
    expect(result.errors?.[0]).toMatch(/takes no parameters/);
  });

  it('a tool with only optional fields still accepts {}', () => {
    expect(validateWithDto(OptionalFieldInput, {}).valid).toBe(true);
  });

  it('a tool with only optional fields still rejects an invalid value for that field', () => {
    const result = validateWithDto(OptionalFieldInput, { status: 'not-a-or-b' });
    expect(result.valid).toBe(false);
  });

  it('a tool with a required field still rejects unexpected extra properties (whitelist unchanged)', () => {
    const result = validateWithDto(RequiredFieldInput, { taskId: 'x', extra: 'unexpected' });
    expect(result.valid).toBe(false);
  });

  it('a tool with a required field accepts exactly the declared shape', () => {
    const result = validateWithDto(RequiredFieldInput, { taskId: 'task-1' });
    expect(result.valid).toBe(true);
  });

  it('rejects null and array inputs the same as before (unchanged non-object guard)', () => {
    expect(validateWithDto(EmptySchemaInput, null).valid).toBe(false);
    expect(validateWithDto(EmptySchemaInput, []).valid).toBe(false);
  });
});
