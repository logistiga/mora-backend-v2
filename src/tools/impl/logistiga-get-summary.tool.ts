import { Injectable } from '@nestjs/common';
import { LogistiGAConnector } from '../../business-connectors/logistiga.connector.js';
import { validateWithDto } from '../tool-validation.util.js';
import type { MoraTool, ToolContext, ToolResult, ToolValidationResult } from '../tool.types.js';

class LogistiGAGetSummaryInput {}

@Injectable()
export class LogistiGAGetSummaryTool implements MoraTool<LogistiGAGetSummaryInput> {
  readonly name = 'logistiga_get_summary';
  readonly description = "Vue d'ensemble en lecture seule des données LogistiGA (compte par type, dernière synchro).";
  readonly version = '1.0.0';
  readonly securityLevel = 'N1' as const;
  readonly allowedScopes = ['professional'] as const;
  readonly requiresConfirmation = false;
  readonly jsonSchema = { type: 'object' as const, properties: {}, additionalProperties: false as const };

  constructor(private readonly connector: LogistiGAConnector) {}

  validate(input: unknown): ToolValidationResult<LogistiGAGetSummaryInput> {
    return validateWithDto(LogistiGAGetSummaryInput, input);
  }

  async execute(context: ToolContext): Promise<ToolResult> {
    if (context.space !== 'logistiga') {
      return { ok: false, errorCode: 'space_mismatch' };
    }
    return { ok: true, data: await this.connector.getSummary() };
  }
}
