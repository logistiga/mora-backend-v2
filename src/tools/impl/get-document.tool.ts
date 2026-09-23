import { Injectable } from '@nestjs/common';
import { IsUUID } from 'class-validator';
import { DocumentService } from '../../documents/document.service.js';
import { validateWithDto } from '../tool-validation.util.js';
import type { MoraTool, ToolContext, ToolResult, ToolValidationResult } from '../tool.types.js';

class GetDocumentInput {
  @IsUUID()
  documentId: string;
}

@Injectable()
export class GetDocumentTool implements MoraTool<GetDocumentInput> {
  readonly name = 'get_document';
  readonly description = 'Récupère les métadonnées et le résumé d\'un document (jamais le fichier binaire brut).';
  readonly version = '1.0.0';
  readonly securityLevel = 'N1' as const;
  readonly allowedScopes = ['personal', 'professional'] as const;
  readonly requiresConfirmation = false;
  readonly jsonSchema = {
    type: 'object' as const,
    properties: { documentId: { type: 'string', format: 'uuid' } },
    required: ['documentId'],
    additionalProperties: false as const,
  };

  constructor(private readonly documentService: DocumentService) {}

  validate(input: unknown): ToolValidationResult<GetDocumentInput> {
    return validateWithDto(GetDocumentInput, input);
  }

  async execute(context: ToolContext, input: GetDocumentInput): Promise<ToolResult> {
    const { document, tags, entities, tables } = await this.documentService.getWithDetails(context.userId, input.documentId);
    if (document.scope !== context.scope || document.space !== context.space) {
      return { ok: false, errorCode: 'scope_mismatch' };
    }
    return { ok: true, data: { document, tags, entities, tables } };
  }
}
