import { Injectable } from '@nestjs/common';
import { IsISO8601, IsOptional, IsString, IsUUID } from 'class-validator';
import { CalendarService } from '../../calendar/calendar.service.js';
import { validateWithDto } from '../tool-validation.util.js';
import type { MoraTool, ToolContext, ToolResult, ToolValidationResult } from '../tool.types.js';

class CalendarUpdateEventInput {
  @IsUUID()
  eventId: string;

  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsISO8601()
  startsAt?: string;

  @IsOptional()
  @IsISO8601()
  endsAt?: string;
}

@Injectable()
export class CalendarUpdateEventTool implements MoraTool<CalendarUpdateEventInput> {
  readonly name = 'calendar_update_event';
  readonly description = 'Modifie un événement existant du calendrier Mora.';
  readonly version = '1.0.0';
  readonly securityLevel = 'N2' as const;
  readonly allowedScopes = ['personal', 'professional'] as const;
  readonly requiresConfirmation = true;
  readonly jsonSchema = {
    type: 'object' as const,
    properties: {
      eventId: { type: 'string', format: 'uuid' },
      title: { type: 'string' },
      startsAt: { type: 'string' },
      endsAt: { type: 'string' },
    },
    required: ['eventId'],
    additionalProperties: false as const,
  };

  constructor(private readonly calendarService: CalendarService) {}

  validate(input: unknown): ToolValidationResult<CalendarUpdateEventInput> {
    return validateWithDto(CalendarUpdateEventInput, input);
  }

  async execute(context: ToolContext, input: CalendarUpdateEventInput): Promise<ToolResult> {
    const existing = await this.calendarService.getEvent(context.userId, input.eventId);
    if (!existing) return { ok: false, errorCode: 'not_found' };
    if (existing.scope !== context.scope || existing.space !== context.space) {
      return { ok: false, errorCode: 'scope_mismatch' };
    }
    const updated = await this.calendarService.updateEvent(context.userId, input.eventId, {
      title: input.title,
      startsAt: input.startsAt ? new Date(input.startsAt) : undefined,
      endsAt: input.endsAt ? new Date(input.endsAt) : undefined,
    });
    return { ok: true, data: updated };
  }
}
