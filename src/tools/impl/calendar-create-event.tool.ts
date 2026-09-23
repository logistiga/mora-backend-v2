import { Injectable } from '@nestjs/common';
import { IsISO8601, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { CalendarService } from '../../calendar/calendar.service.js';
import { validateWithDto } from '../tool-validation.util.js';
import type { MoraTool, ToolContext, ToolResult, ToolValidationResult } from '../tool.types.js';

class CalendarCreateEventInput {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsISO8601()
  startsAt: string;

  @IsISO8601()
  endsAt: string;
}

@Injectable()
export class CalendarCreateEventTool implements MoraTool<CalendarCreateEventInput> {
  readonly name = 'calendar_create_event';
  readonly description = "Crée un événement dans le calendrier Mora, dans le scope/space de la conversation en cours.";
  readonly version = '1.0.0';
  readonly securityLevel = 'N2' as const;
  readonly allowedScopes = ['personal', 'professional'] as const;
  readonly requiresConfirmation = true;
  readonly jsonSchema = {
    type: 'object' as const,
    properties: {
      title: { type: 'string' },
      description: { type: 'string' },
      startsAt: { type: 'string' },
      endsAt: { type: 'string' },
    },
    required: ['title', 'startsAt', 'endsAt'],
    additionalProperties: false as const,
  };

  constructor(private readonly calendarService: CalendarService) {}

  validate(input: unknown): ToolValidationResult<CalendarCreateEventInput> {
    return validateWithDto(CalendarCreateEventInput, input);
  }

  async execute(context: ToolContext, input: CalendarCreateEventInput): Promise<ToolResult> {
    const event = await this.calendarService.createEvent({
      userId: context.userId,
      scope: context.scope,
      space: context.space,
      title: input.title,
      description: input.description,
      startsAt: new Date(input.startsAt),
      endsAt: new Date(input.endsAt),
    });
    return { ok: true, data: event };
  }
}
