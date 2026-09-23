import { Injectable } from '@nestjs/common';
import { IsUUID } from 'class-validator';
import { CalendarService } from '../../calendar/calendar.service.js';
import { validateWithDto } from '../tool-validation.util.js';
import type { MoraTool, ToolContext, ToolResult, ToolValidationResult } from '../tool.types.js';

class CalendarGetEventInput {
  @IsUUID()
  eventId: string;
}

@Injectable()
export class CalendarGetEventTool implements MoraTool<CalendarGetEventInput> {
  readonly name = 'calendar_get_event';
  readonly description = 'Récupère un événement du calendrier Mora.';
  readonly version = '1.0.0';
  readonly securityLevel = 'N1' as const;
  readonly allowedScopes = ['personal', 'professional'] as const;
  readonly requiresConfirmation = false;
  readonly jsonSchema = {
    type: 'object' as const,
    properties: { eventId: { type: 'string', format: 'uuid' } },
    required: ['eventId'],
    additionalProperties: false as const,
  };

  constructor(private readonly calendarService: CalendarService) {}

  validate(input: unknown): ToolValidationResult<CalendarGetEventInput> {
    return validateWithDto(CalendarGetEventInput, input);
  }

  async execute(context: ToolContext, input: CalendarGetEventInput): Promise<ToolResult> {
    const event = await this.calendarService.getEvent(context.userId, input.eventId);
    if (!event) return { ok: false, errorCode: 'not_found' };
    if (event.scope !== context.scope || event.space !== context.space) {
      return { ok: false, errorCode: 'scope_mismatch' };
    }
    return { ok: true, data: event };
  }
}
