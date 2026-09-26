import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsObject, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

const CATEGORIES = ['ui', 'api', 'voice', 'vision', 'avatar', 'auth', 'performance', 'other'] as const;
const SEVERITIES = ['low', 'medium', 'high', 'critical'] as const;

export class CreateBugReportDto {
  @ApiProperty({ enum: CATEGORIES })
  @IsIn(CATEGORIES)
  category: (typeof CATEGORIES)[number];

  @ApiProperty({ enum: SEVERITIES })
  @IsIn(SEVERITIES)
  severity: (typeof SEVERITIES)[number];

  @ApiProperty()
  @IsString()
  @MaxLength(160)
  title: string;

  @ApiProperty()
  @IsString()
  @MaxLength(4000)
  description: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  requestId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  conversationId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  voiceSessionId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(300)
  frontendRoute?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(300)
  apiRoute?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(600)
  browserInfo?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  appVersion?: string;

  @ApiPropertyOptional({ type: 'object', additionalProperties: true })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}
