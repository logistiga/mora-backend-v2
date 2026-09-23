import { Injectable } from '@nestjs/common';
import { IsOptional, IsString, MinLength } from 'class-validator';
import { PistonConnector } from '../../business-connectors/piston.connector.js';
import { validateWithDto } from '../tool-validation.util.js';
import type { MoraTool, ToolContext, ToolResult, ToolValidationResult } from '../tool.types.js';

class PistonSearchInput {
  @IsString()
  @MinLength(1)
  query: string;

  @IsOptional()
  @IsString()
  entityType?: string;
}

@Injectable()
export class PistonSearchTool implements MoraTool<PistonSearchInput> {
  readonly name = 'piston_search';
  readonly description = 'Recherche en lecture seule dans les données Piston (projets, fournisseurs, ...).';
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

  constructor(private readonly connector: PistonConnector) {}

  validate(input: unknown): ToolValidationResult<PistonSearchInput> {
    return validateWithDto(PistonSearchInput, input);
  }

  async execute(context: ToolContext, input: PistonSearchInput): Promise<ToolResult> {
    if (context.space !== 'piston') {
      return { ok: false, errorCode: 'space_mismatch' };
    }
    const result = await this.connector.search(input.query, input.entityType);
    return { ok: true, data: result };
  }
}
