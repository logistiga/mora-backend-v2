import { Injectable } from '@nestjs/common';
import { IsString, MinLength } from 'class-validator';
import { PistonConnector } from '../../business-connectors/piston.connector.js';
import { validateWithDto } from '../tool-validation.util.js';
import type { MoraTool, ToolContext, ToolResult, ToolValidationResult } from '../tool.types.js';

class PistonGetEntityInput {
  @IsString()
  @MinLength(1)
  entityId: string;
}

@Injectable()
export class PistonGetEntityTool implements MoraTool<PistonGetEntityInput> {
  readonly name = 'piston_get_entity';
  readonly description = 'Récupère une entité Piston précise (lecture seule) par id.';
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

  constructor(private readonly connector: PistonConnector) {}

  validate(input: unknown): ToolValidationResult<PistonGetEntityInput> {
    return validateWithDto(PistonGetEntityInput, input);
  }

  async execute(context: ToolContext, input: PistonGetEntityInput): Promise<ToolResult> {
    if (context.space !== 'piston') {
      return { ok: false, errorCode: 'space_mismatch' };
    }
    const entity = await this.connector.getEntity(input.entityId);
    return { ok: true, data: entity };
  }
}
