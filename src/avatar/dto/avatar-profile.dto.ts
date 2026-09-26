import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsIn, IsNumber, IsObject, IsOptional, IsString, Max, Min } from 'class-validator';

export class UpdateAvatarProfileDto {
  @ApiPropertyOptional({ example: 'Mora Core' })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({ example: 'mora_core' })
  @IsOptional()
  @IsString()
  avatarPreset?: string;

  @ApiPropertyOptional({ enum: ['expressive_orb', 'humanoid_placeholder', 'minimal'] })
  @IsOptional()
  @IsIn(['expressive_orb', 'humanoid_placeholder', 'minimal'])
  renderMode?: 'expressive_orb' | 'humanoid_placeholder' | 'minimal';

  @ApiPropertyOptional({ enum: ['neutral', 'attentive', 'thinking', 'explaining', 'vision_focus', 'confirming', 'celebrating', 'concerned', 'error'] })
  @IsOptional()
  @IsIn(['neutral', 'attentive', 'thinking', 'explaining', 'vision_focus', 'confirming', 'celebrating', 'concerned', 'error'])
  baseExpression?: 'neutral' | 'attentive' | 'thinking' | 'explaining' | 'vision_focus' | 'confirming' | 'celebrating' | 'concerned' | 'error';

  @ApiPropertyOptional({ example: 0.7, minimum: 0, maximum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(1)
  expressionIntensity?: number;

  @ApiPropertyOptional({ enum: ['viseme_timeline', 'disabled'] })
  @IsOptional()
  @IsIn(['viseme_timeline', 'disabled'])
  lipSyncMode?: 'viseme_timeline' | 'disabled';

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  voiceSyncEnabled?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  idleEnabled?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  reducedMotion?: boolean;

  @ApiPropertyOptional({ type: 'object', additionalProperties: true })
  @IsOptional()
  @IsObject()
  settings?: Record<string, unknown>;
}
