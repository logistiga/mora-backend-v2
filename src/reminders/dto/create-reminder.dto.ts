import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsISO8601, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { REMINDER_SCOPES } from '../reminder.types.js';

export class CreateReminderDto {
  @ApiProperty({ enum: REMINDER_SCOPES })
  @IsIn(REMINDER_SCOPES)
  scope: 'personal' | 'professional';

  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  space: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  message?: string;

  @ApiProperty({ description: 'ISO 8601 date-time in the future' })
  @IsISO8601()
  remindAt: string;
}
