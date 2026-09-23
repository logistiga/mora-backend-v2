import { Injectable } from '@nestjs/common';
import { IsISO8601 } from 'class-validator';
import { CalendarService } from '../../calendar/calendar.service.js';
import { validateWithDto } from '../tool-validation.util.js';
import type { MoraTool, ToolContext, ToolResult, ToolValidationResult } from '../tool.types.js';

class CalendarListEventsInput {
  @IsISO8601()
  from: string;

  @IsISO8601()
  to: string;
}

@Injectable()
export class CalendarListEventsTool implements MoraTool<CalendarListEventsInput> {
  readonly name = 'calendar_list_events';
  readonly description = "Liste les événements du calendrier Mora dans le scope/space courant, pour une plage de dates.";
  readonly version = '1.0.0';
  readonly securityLevel = 'N1' as const;
  readonly allowedScopes = ['personal', 'professional'] as const;
  readonly requiresConfirmation = false;
  readonly jsonSchema = {
    type: 'object' as const,
    properties: { from: { type: 'string' }, to: { type: 'string' } },
    required: ['from', 'to'],
    additionalProperties: false as const,
  };

  constructor(private readonly calendarService: CalendarService) {}

  validate(input: unknown): ToolValidationResult<CalendarListEventsInput> {
    return validateWithDto(CalendarListEventsInput, input);
  }

  async execute(context: ToolContext, input: CalendarListEventsInput): Promise<ToolResult> {
    const events = await this.calendarService.listEvents(context.userId, context.scope, context.space, new Date(input.from), new Date(input.to));
    return { ok: true, data: events };
  }
}
