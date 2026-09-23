import { Injectable } from '@nestjs/common';
import { IsOptional, IsString, MinLength } from 'class-validator';
import { LogistiGAConnector } from '../../business-connectors/logistiga.connector.js';
import { validateWithDto } from '../tool-validation.util.js';
import type { MoraTool, ToolContext, ToolResult, ToolValidationResult } from '../tool.types.js';

class LogistiGASearchInput {
  @IsString()
  @MinLength(1)
  query: string;

  @IsOptional()
  @IsString()
  entityType?: string;
}

/** Professional-only (AGENTS §44/§45): read-only business reference data, never Personal. */
@Injectable()
export class LogistiGASearchTool implements MoraTool<LogistiGASearchInput> {
  readonly name = 'logistiga_search';
  readonly description = 'Recherche en lecture seule dans les données LogistiGA (clients, expéditions, ...).';
  readonly version = '1.0.0';
  readonly securityLevel = 'N1' as const;
  readonly allowedScopes = ['professional'] as const;
  readonly requiresConfirmation = false;
  readonly jsonSchema = {
    type: 'object' as const,
    properties: { query: { type: 'string' }, entityType: { type: 'string' } },
    required: ['query'],
    additionalProperties: false as const,
  };

  constructor(private readonly connector: LogistiGAConnector) {}

  validate(input: unknown): ToolValidationResult<LogistiGASearchInput> {
    return validateWithDto(LogistiGASearchInput, input);
  }

  async execute(context: ToolContext, input: LogistiGASearchInput): Promise<ToolResult> {
    if (context.space !== 'logistiga') {
      return { ok: false, errorCode: 'space_mismatch', errorMessage: 'This tool is only available in the LogistiGA space' };
    }
    const result = await this.connector.search(input.query, input.entityType);
    return { ok: true, data: result };
  }
}
