import { Injectable } from '@nestjs/common';
import { IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';
import { MemoryRetrievalService } from '../../memory/memory-retrieval.service.js';
import { validateWithDto } from '../tool-validation.util.js';
import type { MoraTool, ToolContext, ToolResult, ToolValidationResult } from '../tool.types.js';

class SearchMemoriesInput {
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  query: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(20)
  limit?: number;
}

/**
 * Read-only, N1: reuses the exact same MemoryRetrievalService the
 * ContextBuilder already uses (Phase C) — semantic pgvector search when an
 * embedding provider is configured, text-fallback otherwise, scoped by
 * (userId, scope, space) like every other memory query in this codebase.
 */
@Injectable()
export class SearchMemoriesTool implements MoraTool<SearchMemoriesInput> {
  readonly name = 'search_memories';
  readonly description = "Recherche dans les mémoires (faits, préférences, habitudes...) de l'utilisateur, dans le scope/space courant.";
  readonly version = '1.0.0';
  readonly securityLevel = 'N1' as const;
  readonly allowedScopes = ['personal', 'professional'] as const;
  readonly requiresConfirmation = false;
  readonly jsonSchema = {
    type: 'object' as const,
    properties: {
      query: { type: 'string' },
      limit: { type: 'integer', minimum: 1, maximum: 20 },
    },
    required: ['query'],
    additionalProperties: false as const,
  };

  constructor(private readonly memoryRetrieval: MemoryRetrievalService) {}

  validate(input: unknown): ToolValidationResult<SearchMemoriesInput> {
    return validateWithDto(SearchMemoriesInput, input);
  }

  async execute(context: ToolContext, input: SearchMemoriesInput): Promise<ToolResult> {
    const outcome = await this.memoryRetrieval.retrieve({
      userId: context.userId,
      scope: context.scope,
      space: context.space,
      queryText: input.query,
      limit: input.limit,
    });
    return { ok: true, data: { mode: outcome.mode, memories: outcome.memories } };
  }
}
