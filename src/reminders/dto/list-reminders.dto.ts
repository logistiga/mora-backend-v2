import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString } from 'class-validator';
import { REMINDER_SCOPES, REMINDER_STATUSES, type ReminderStatus } from '../reminder.types.js';

export class ListRemindersQueryDto {
  @ApiPropertyOptional({ enum: REMINDER_SCOPES })
  @IsOptional()
  @IsIn(REMINDER_SCOPES)
  scope?: 'personal' | 'professional';

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  space?: string;

  @ApiPropertyOptional({ enum: REMINDER_STATUSES })
  @IsOptional()
  @IsIn(REMINDER_STATUSES)
  status?: ReminderStatus;
}
