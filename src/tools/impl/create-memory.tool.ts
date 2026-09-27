import { Injectable } from '@nestjs/common';
import { IsIn, IsNumber, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';
import { MemoryService } from '../../memory/memory.service.js';
import { MEMORY_KINDS, type MemoryKind, type MemoryScope, type MemorySpace } from '../../memory/memory.types.js';
import { validateWithDto } from '../tool-validation.util.js';
import type { MoraTool, ToolContext, ToolResult, ToolValidationResult } from '../tool.types.js';

// scope/space never come from the LLM: they are taken from ToolContext, like
// every other write tool here, so an explicit "retiens que..." can never
// store a personal fact into a professional space.
class CreateMemoryInput {
  @IsString()
  @MinLength(1)
  @MaxLength(4000)
  content: string;

  @IsOptional()
  @IsIn(MEMORY_KINDS)
  kind?: MemoryKind;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  importance?: number;
}

/**
 * Explicit user-driven memorisation ("retiens que...", "souviens-toi
 * que...", "mémorise..."). Without this tool the model has no write path to
 * the memory system and falls back to the closest available write tool,
 * which is `create_task` — the user ends up with a task instead of a
 * memory.
 *
 * N1 (no confirmation): it only writes the user's own memory in the current
 * scope/space, is reversible through the memory API, and the whole point of
 * the phrasing is that the user already asked for it explicitly.
 */
@Injectable()
export class CreateMemoryTool implements MoraTool<CreateMemoryInput> {
  readonly name = 'create_memory';
  readonly description =
    "Mémorise durablement une information que l'utilisateur demande explicitement de retenir " +
    "(\"retiens que\", \"souviens-toi que\", \"mémorise\", \"note que\"), dans le scope/space de la conversation.";
  readonly version = '1.0.0';
  readonly securityLevel = 'N1' as const;
  readonly allowedScopes = ['personal', 'professional'] as const;
  readonly requiresConfirmation = false;
  readonly jsonSchema = {
    type: 'object' as const,
    properties: {
      content: {
        type: 'string',
        description: "L'information à retenir, reformulée en une phrase autonome et factuelle",
      },
      kind: { type: 'string', enum: MEMORY_KINDS },
      importance: { type: 'number', minimum: 0, maximum: 1 },
    },
    required: ['content'],
    additionalProperties: false as const,
  };

  constructor(private readonly memoryService: MemoryService) {}

  validate(input: unknown): ToolValidationResult<CreateMemoryInput> {
    return validateWithDto(CreateMemoryInput, input);
  }

  async execute(context: ToolContext, input: CreateMemoryInput): Promise<ToolResult> {
    const memory = await this.memoryService.create(
      context.userId,
      {
        scope: context.scope as MemoryScope,
        space: context.space as MemorySpace,
        kind: input.kind ?? 'fact',
        content: input.content,
        importance: input.importance ?? 0.7,
        confidence: 0.9,
        metadata: { source: 'explicit_user_request', conversationId: context.conversationId },
      },
      'manual',
      context.conversationId,
    );

    return {
      ok: true,
      data: { id: memory.id, kind: memory.kind, content: memory.content, scope: memory.scope, space: memory.space },
    };
  }
}
