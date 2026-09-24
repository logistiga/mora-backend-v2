import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsNumber, IsOptional, IsString, Max, Min, MinLength } from 'class-validator';
import { SUPPORTED_VOICE_LANGUAGES } from '../voice.types.js';

export class CreateVoiceProfileDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  name: string;

  @ApiProperty({ description: 'AI provider name, e.g. "openai"' })
  @IsString()
  @MinLength(1)
  provider: string;

  @ApiProperty({ description: 'Provider-specific voice id, e.g. "alloy"' })
  @IsString()
  @MinLength(1)
  voiceId: string;

  @ApiPropertyOptional({ enum: SUPPORTED_VOICE_LANGUAGES, default: 'auto' })
  @IsOptional()
  @IsIn(SUPPORTED_VOICE_LANGUAGES)
  language?: string;

  @ApiPropertyOptional({ default: 1.0 })
  @IsOptional()
  @IsNumber()
  @Min(0.5)
  @Max(2.0)
  speed?: number;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}

export class UpdateVoiceProfileDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(1)
  voiceId?: string;

  @ApiPropertyOptional({ enum: SUPPORTED_VOICE_LANGUAGES })
  @IsOptional()
  @IsIn(SUPPORTED_VOICE_LANGUAGES)
  language?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0.5)
  @Max(2.0)
  speed?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}
