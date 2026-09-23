import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsIn, IsISO8601, IsOptional, IsString, MinLength } from 'class-validator';
import { CALENDAR_SCOPES } from '../calendar.types.js';

export class CreateEventDto {
  @ApiProperty({ enum: CALENDAR_SCOPES })
  @IsIn(CALENDAR_SCOPES)
  scope: 'personal' | 'professional';

  @ApiProperty()
  @IsString()
  @MinLength(1)
  space: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  title: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  location?: string;

  @ApiProperty()
  @IsISO8601()
  startsAt: string;

  @ApiProperty()
  @IsISO8601()
  endsAt: string;

  @ApiPropertyOptional({ type: [String], description: 'Contact ids to attach as participants' })
  @IsOptional()
  @IsArray()
  participantContactIds?: string[];
}
