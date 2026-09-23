import { Injectable } from '@nestjs/common';
import { IsArray, IsOptional, IsString, MinLength } from 'class-validator';
import { DocumentRetrievalService } from '../../documents/document-retrieval.service.js';
import { validateWithDto } from '../tool-validation.util.js';
import type { MoraTool, ToolContext, ToolResult, ToolValidationResult } from '../tool.types.js';

class SearchDocumentContentInput {
  @IsString()
  @MinLength(1)
  query: string;

  @IsOptional()
  @IsArray()
  tags?: string[];
}

/**
 * Multi-stage document retrieval (AGENTS Phase E §12), never a raw dump of
 * document content into the LLM's context — bounded to the top-ranked
 * chunks with provenance (documentId/page/section) for citation.
 */
@Injectable()
export class SearchDocumentContentTool implements MoraTool<SearchDocumentContentInput> {
  readonly name = 'search_document_content';
  readonly description = 'Recherche sémantique/texte dans le contenu des documents (chunks pertinents avec provenance).';
  readonly version = '1.0.0';
  readonly securityLevel = 'N1' as const;
  readonly allowedScopes = ['personal', 'professional'] as const;
  readonly requiresConfirmation = false;
  readonly jsonSchema = {
    type: 'object' as const,
    properties: { query: { type: 'string' }, tags: { type: 'array', items: { type: 'string' } } },
    required: ['query'],
    additionalProperties: false as const,
  };

  constructor(private readonly retrieval: DocumentRetrievalService) {}

  validate(input: unknown): ToolValidationResult<SearchDocumentContentInput> {
    return validateWithDto(SearchDocumentContentInput, input);
  }

  async execute(context: ToolContext, input: SearchDocumentContentInput): Promise<ToolResult> {
    const outcome = await this.retrieval.retrieve({
      userId: context.userId,
      scope: context.scope,
      space: context.space,
      queryText: input.query,
      tags: input.tags,
    });
    return { ok: true, data: outcome };
  }
}
