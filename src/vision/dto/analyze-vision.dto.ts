import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';
import { VISION_ALLOWED_SOURCE_TYPES } from '../vision.types.js';

export class AnalyzeVisionDto {
  @ApiProperty({ example: 'Que vois-tu sur cette image ?' })
  @IsString()
  @MinLength(1)
  @MaxLength(8000)
  message: string;

  @ApiProperty({ enum: ['personal', 'professional'] })
  @IsIn(['personal', 'professional'])
  scope: 'personal' | 'professional';

  @ApiProperty({ example: 'default' })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  space: string;

  @ApiPropertyOptional({ description: 'Conversation existante a continuer' })
  @IsOptional()
  @IsUUID()
  conversationId?: string;

  @ApiPropertyOptional({ enum: VISION_ALLOWED_SOURCE_TYPES, default: 'upload' })
  @IsOptional()
  @IsIn(VISION_ALLOWED_SOURCE_TYPES)
  sourceType?: (typeof VISION_ALLOWED_SOURCE_TYPES)[number];
}

export class VisionStatusQueryDto {
  @ApiProperty({ enum: ['personal', 'professional'] })
  @IsIn(['personal', 'professional'])
  scope: 'personal' | 'professional';

  @ApiProperty({ example: 'default' })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  space: string;
}
