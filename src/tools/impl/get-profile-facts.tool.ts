import { Injectable } from '@nestjs/common';
import { ProfileFactsService } from '../../memory/profile-facts.service.js';
import { validateWithDto } from '../tool-validation.util.js';
import type { MoraTool, ToolContext, ToolResult, ToolValidationResult } from '../tool.types.js';

// No arguments needed beyond context — deliberately kept minimal to avoid
// giving the LLM a way to ask for a scope/space other than the current one.
class GetProfileFactsInput {}

@Injectable()
export class GetProfileFactsTool implements MoraTool<GetProfileFactsInput> {
  readonly name = 'get_profile_facts';
  readonly description = "Récupère les faits de profil connus de l'utilisateur dans le scope/space courant.";
  readonly version = '1.0.0';
  readonly securityLevel = 'N1' as const;
  readonly allowedScopes = ['personal', 'professional'] as const;
  readonly requiresConfirmation = false;
  readonly jsonSchema = { type: 'object' as const, properties: {}, additionalProperties: false as const };

  constructor(private readonly profileFactsService: ProfileFactsService) {}

  validate(input: unknown): ToolValidationResult<GetProfileFactsInput> {
    return validateWithDto(GetProfileFactsInput, input);
  }

  async execute(context: ToolContext): Promise<ToolResult> {
    const facts = await this.profileFactsService.getRelevant(context.userId, context.scope, context.space);
    return { ok: true, data: facts };
  }
}
