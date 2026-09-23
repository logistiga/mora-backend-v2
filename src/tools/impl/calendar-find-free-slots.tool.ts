import { Injectable } from '@nestjs/common';
import { IsISO8601, IsInt, IsOptional, Max, Min } from 'class-validator';
import { CalendarService } from '../../calendar/calendar.service.js';
import { validateWithDto } from '../tool-validation.util.js';
import type { MoraTool, ToolContext, ToolResult, ToolValidationResult } from '../tool.types.js';

class CalendarFindFreeSlotsInput {
  @IsISO8601()
  from: string;

  @IsISO8601()
  to: string;

  @IsOptional()
  @IsInt()
  @Min(5)
  @Max(480)
  durationMinutes?: number;
}

@Injectable()
export class CalendarFindFreeSlotsTool implements MoraTool<CalendarFindFreeSlotsInput> {
  readonly name = 'calendar_find_free_slots';
  readonly description = 'Trouve des créneaux libres dans le calendrier Mora pour une durée donnée.';
  readonly version = '1.0.0';
  readonly securityLevel = 'N1' as const;
  readonly allowedScopes = ['personal', 'professional'] as const;
  readonly requiresConfirmation = false;
  readonly jsonSchema = {
    type: 'object' as const,
    properties: { from: { type: 'string' }, to: { type: 'string' }, durationMinutes: { type: 'integer' } },
    required: ['from', 'to'],
    additionalProperties: false as const,
  };

  constructor(private readonly calendarService: CalendarService) {}

  validate(input: unknown): ToolValidationResult<CalendarFindFreeSlotsInput> {
    return validateWithDto(CalendarFindFreeSlotsInput, input);
  }

  async execute(context: ToolContext, input: CalendarFindFreeSlotsInput): Promise<ToolResult> {
    const slots = await this.calendarService.findFreeSlots(
      context.userId,
      context.scope,
      context.space,
      new Date(input.from),
      new Date(input.to),
      input.durationMinutes ?? 30,
    );
    return { ok: true, data: slots };
  }
}
