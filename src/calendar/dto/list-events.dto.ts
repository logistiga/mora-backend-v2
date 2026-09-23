import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsISO8601, IsOptional, IsString } from 'class-validator';
import { CALENDAR_SCOPES } from '../calendar.types.js';

export class ListEventsQueryDto {
  @ApiPropertyOptional({ enum: CALENDAR_SCOPES })
  @IsOptional()
  @IsIn(CALENDAR_SCOPES)
  scope?: 'personal' | 'professional';

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  space?: string;

  @ApiProperty()
  @IsISO8601()
  from: string;

  @ApiProperty()
  @IsISO8601()
  to: string;
}
