import { Injectable } from '@nestjs/common';
import { IsIn, IsOptional } from 'class-validator';
import { REMINDER_STATUSES, type ReminderStatus } from '../../reminders/reminder.types.js';
import { ReminderService } from '../../reminders/reminder.service.js';
import { validateWithDto } from '../tool-validation.util.js';
import type { MoraTool, ToolContext, ToolResult, ToolValidationResult } from '../tool.types.js';

class ListRemindersInput {
  @IsOptional()
  @IsIn(REMINDER_STATUSES)
  status?: ReminderStatus;
}

@Injectable()
export class ListRemindersTool implements MoraTool<ListRemindersInput> {
  readonly name = 'list_reminders';
  readonly description = "Liste les rappels de l'utilisateur dans le scope/space de la conversation en cours.";
  readonly version = '1.0.0';
  readonly securityLevel = 'N1' as const;
  readonly allowedScopes = ['personal', 'professional'] as const;
  readonly requiresConfirmation = false;
  readonly jsonSchema = {
    type: 'object' as const,
    properties: { status: { type: 'string', enum: REMINDER_STATUSES } },
    additionalProperties: false as const,
  };

  constructor(private readonly reminderService: ReminderService) {}

  validate(input: unknown): ToolValidationResult<ListRemindersInput> {
    return validateWithDto(ListRemindersInput, input);
  }

  async execute(context: ToolContext, input: ListRemindersInput): Promise<ToolResult> {
    const reminders = await this.reminderService.list(context.userId, {
      scope: context.scope,
      space: context.space,
      status: input.status,
    });
    return { ok: true, data: reminders };
  }
}
