import { Injectable } from '@nestjs/common';
import { IsArray, IsOptional, IsString } from 'class-validator';
import { PrismaService } from '../../database/prisma.service.js';
import { validateWithDto } from '../tool-validation.util.js';
import type { MoraTool, ToolContext, ToolResult, ToolValidationResult } from '../tool.types.js';

class SearchDocumentsInput {
  @IsOptional()
  @IsString()
  documentType?: string;

  @IsOptional()
  @IsArray()
  tags?: string[];
}

@Injectable()
export class SearchDocumentsTool implements MoraTool<SearchDocumentsInput> {
  readonly name = 'search_documents';
  readonly description = "Liste/filtre les documents de l'utilisateur (type, tags) dans le scope/space courant.";
  readonly version = '1.0.0';
  readonly securityLevel = 'N1' as const;
  readonly allowedScopes = ['personal', 'professional'] as const;
  readonly requiresConfirmation = false;
  readonly jsonSchema = {
    type: 'object' as const,
    properties: { documentType: { type: 'string' }, tags: { type: 'array', items: { type: 'string' } } },
    additionalProperties: false as const,
  };

  constructor(private readonly prisma: PrismaService) {}

  validate(input: unknown): ToolValidationResult<SearchDocumentsInput> {
    return validateWithDto(SearchDocumentsInput, input);
  }

  async execute(context: ToolContext, input: SearchDocumentsInput): Promise<ToolResult> {
    const documents = await this.prisma.document.findMany({
      where: {
        userId: context.userId,
        scope: context.scope,
        space: context.space,
        status: 'ready',
        documentType: input.documentType,
        ...(input.tags?.length ? { docTags: { some: { tag: { name: { in: input.tags } } } } } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 30,
      select: { id: true, title: true, originalFilename: true, documentType: true, summary: true, createdAt: true },
    });
    return { ok: true, data: documents };
  }
}
