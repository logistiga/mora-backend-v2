import { Injectable } from '@nestjs/common';
import { PistonConnector } from '../../business-connectors/piston.connector.js';
import { validateWithDto } from '../tool-validation.util.js';
import type { MoraTool, ToolContext, ToolResult, ToolValidationResult } from '../tool.types.js';

class PistonGetSummaryInput {}

@Injectable()
export class PistonGetSummaryTool implements MoraTool<PistonGetSummaryInput> {
  readonly name = 'piston_get_summary';
  readonly description = "Vue d'ensemble en lecture seule des données Piston.";
  readonly version = '1.0.0';
  readonly securityLevel = 'N1' as const;
  readonly allowedScopes = ['professional'] as const;
  readonly requiresConfirmation = false;
  readonly jsonSchema = { type: 'object' as const, properties: {}, additionalProperties: false as const };

  constructor(private readonly connector: PistonConnector) {}

  validate(input: unknown): ToolValidationResult<PistonGetSummaryInput> {
    return validateWithDto(PistonGetSummaryInput, input);
  }

  async execute(context: ToolContext): Promise<ToolResult> {
    if (context.space !== 'piston') {
      return { ok: false, errorCode: 'space_mismatch' };
    }
    return { ok: true, data: await this.connector.getSummary() };
  }
}
