import { Injectable } from '@nestjs/common';
import { IsUUID } from 'class-validator';
import { CalendarService } from '../../calendar/calendar.service.js';
import { validateWithDto } from '../tool-validation.util.js';
import type { MoraTool, ToolContext, ToolResult, ToolValidationResult } from '../tool.types.js';

class CalendarCancelEventInput {
  @IsUUID()
  eventId: string;
}

@Injectable()
export class CalendarCancelEventTool implements MoraTool<CalendarCancelEventInput> {
  readonly name = 'calendar_cancel_event';
  readonly description = "Annule un événement du calendrier Mora.";
  readonly version = '1.0.0';
  readonly securityLevel = 'N2' as const;
  readonly allowedScopes = ['personal', 'professional'] as const;
  readonly requiresConfirmation = true;
  readonly jsonSchema = {
    type: 'object' as const,
    properties: { eventId: { type: 'string', format: 'uuid' } },
    required: ['eventId'],
    additionalProperties: false as const,
  };

  constructor(private readonly calendarService: CalendarService) {}

  validate(input: unknown): ToolValidationResult<CalendarCancelEventInput> {
    return validateWithDto(CalendarCancelEventInput, input);
  }

  async execute(context: ToolContext, input: CalendarCancelEventInput): Promise<ToolResult> {
    const existing = await this.calendarService.getEvent(context.userId, input.eventId);
    if (!existing) return { ok: false, errorCode: 'not_found' };
    if (existing.scope !== context.scope || existing.space !== context.space) {
      return { ok: false, errorCode: 'scope_mismatch' };
    }
    const cancelled = await this.calendarService.cancelEvent(context.userId, input.eventId);
    return { ok: true, data: cancelled };
  }
}
