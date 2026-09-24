import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, IsUUID, MinLength } from 'class-validator';
import { SUPPORTED_VOICE_LANGUAGES, VOICE_MODES } from '../voice.types.js';

export class CreateVoiceSessionDto {
  @ApiProperty({ enum: ['personal', 'professional'] })
  @IsIn(['personal', 'professional'])
  scope: 'personal' | 'professional';

  @ApiProperty()
  @IsString()
  @MinLength(1)
  space: string;

  @ApiPropertyOptional({ description: 'Existing conversation to continue in voice — omit to start a new one' })
  @IsOptional()
  @IsUUID()
  conversationId?: string;

  @ApiPropertyOptional({ enum: SUPPORTED_VOICE_LANGUAGES, default: 'auto' })
  @IsOptional()
  @IsIn(SUPPORTED_VOICE_LANGUAGES)
  language?: string;

  @ApiPropertyOptional({ enum: VOICE_MODES, default: 'push_to_talk' })
  @IsOptional()
  @IsIn(VOICE_MODES)
  mode?: string;

  @ApiPropertyOptional({ description: 'IANA timezone; defaults to MORA_DEFAULT_TIMEZONE' })
  @IsOptional()
  @IsString()
  timezone?: string;
}
