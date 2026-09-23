import { Injectable } from '@nestjs/common';
import { IsString, MinLength } from 'class-validator';
import { LogistiGAConnector } from '../../business-connectors/logistiga.connector.js';
import { validateWithDto } from '../tool-validation.util.js';
import type { MoraTool, ToolContext, ToolResult, ToolValidationResult } from '../tool.types.js';

class LogistiGAGetEntityInput {
  @IsString()
  @MinLength(1)
  entityId: string;
}

@Injectable()
export class LogistiGAGetEntityTool implements MoraTool<LogistiGAGetEntityInput> {
  readonly name = 'logistiga_get_entity';
  readonly description = 'Récupère une entité LogistiGA précise (lecture seule) par id.';
  readonly version = '1.0.0';
  readonly securityLevel = 'N1' as const;
  readonly allowedScopes = ['professional'] as const;
  readonly requiresConfirmation = false;
  readonly jsonSchema = {
    type: 'object' as const,
    properties: { entityId: { type: 'string' } },
    required: ['entityId'],
    additionalProperties: false as const,
  };

  constructor(private readonly connector: LogistiGAConnector) {}

  validate(input: unknown): ToolValidationResult<LogistiGAGetEntityInput> {
    return validateWithDto(LogistiGAGetEntityInput, input);
  }

  async execute(context: ToolContext, input: LogistiGAGetEntityInput): Promise<ToolResult> {
    if (context.space !== 'logistiga') {
      return { ok: false, errorCode: 'space_mismatch' };
    }
    const entity = await this.connector.getEntity(input.entityId);
    return { ok: true, data: entity };
  }
}
