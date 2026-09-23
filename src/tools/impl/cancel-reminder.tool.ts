import { Injectable } from '@nestjs/common';
import { IsUUID } from 'class-validator';
import { ReminderService } from '../../reminders/reminder.service.js';
import { validateWithDto } from '../tool-validation.util.js';
import type { MoraTool, ToolContext, ToolResult, ToolValidationResult } from '../tool.types.js';

class CancelReminderInput {
  @IsUUID()
  reminderId: string;
}

@Injectable()
export class CancelReminderTool implements MoraTool<CancelReminderInput> {
  readonly name = 'cancel_reminder';
  readonly description = "Annule un rappel programmé de l'utilisateur.";
  readonly version = '1.0.0';
  readonly securityLevel = 'N2' as const;
  readonly allowedScopes = ['personal', 'professional'] as const;
  readonly requiresConfirmation = true;
  readonly jsonSchema = {
    type: 'object' as const,
    properties: { reminderId: { type: 'string', format: 'uuid' } },
    required: ['reminderId'],
    additionalProperties: false as const,
  };

  constructor(private readonly reminderService: ReminderService) {}

  validate(input: unknown): ToolValidationResult<CancelReminderInput> {
    return validateWithDto(CancelReminderInput, input);
  }

  async execute(context: ToolContext, input: CancelReminderInput): Promise<ToolResult> {
    const existing = await this.reminderService.getById(context.userId, input.reminderId);
    if (existing.scope !== context.scope || existing.space !== context.space) {
      return { ok: false, errorCode: 'scope_mismatch', errorMessage: 'Reminder is outside this conversation\'s scope/space' };
    }
    const cancelled = await this.reminderService.cancel(context.userId, input.reminderId);
    return { ok: true, data: cancelled };
  }
}
