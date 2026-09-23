import { Injectable } from '@nestjs/common';
import { IsISO8601, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { ReminderService } from '../../reminders/reminder.service.js';
import { validateWithDto } from '../tool-validation.util.js';
import type { MoraTool, ToolContext, ToolResult, ToolValidationResult } from '../tool.types.js';

class CreateReminderInput {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  message?: string;

  @IsISO8601()
  remindAt: string;
}

@Injectable()
export class CreateReminderTool implements MoraTool<CreateReminderInput> {
  readonly name = 'create_reminder';
  readonly description = "Crée un rappel qui déclenchera une notification interne à l'heure indiquée.";
  readonly version = '1.0.0';
  readonly securityLevel = 'N2' as const;
  readonly allowedScopes = ['personal', 'professional'] as const;
  readonly requiresConfirmation = true;
  readonly jsonSchema = {
    type: 'object' as const,
    properties: {
      title: { type: 'string' },
      message: { type: 'string' },
      remindAt: { type: 'string', description: 'Date/heure ISO 8601 dans le futur' },
    },
    required: ['title', 'remindAt'],
    additionalProperties: false as const,
  };

  constructor(private readonly reminderService: ReminderService) {}

  validate(input: unknown): ToolValidationResult<CreateReminderInput> {
    return validateWithDto(CreateReminderInput, input);
  }

  async execute(context: ToolContext, input: CreateReminderInput): Promise<ToolResult> {
    const reminder = await this.reminderService.create(
      context.userId,
      { scope: context.scope, space: context.space, title: input.title, message: input.message, remindAt: input.remindAt },
      'tool',
      context.conversationId,
    );
    return { ok: true, data: reminder };
  }
}
