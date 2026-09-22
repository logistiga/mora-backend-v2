import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsNumber, IsObject, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';
import { MEMORY_KINDS, MEMORY_SCOPES, MEMORY_SPACES } from '../memory.types.js';

export class CreateMemoryDto {
  @ApiProperty({ enum: MEMORY_SCOPES })
  @IsIn(MEMORY_SCOPES)
  scope: 'personal' | 'professional';

  @ApiProperty({ enum: MEMORY_SPACES })
  @IsIn(MEMORY_SPACES)
  space: string;

  @ApiProperty({ enum: MEMORY_KINDS })
  @IsIn(MEMORY_KINDS)
  kind: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(4000)
  content: string;

  @ApiPropertyOptional({ minimum: 0, maximum: 1, default: 0.5 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  importance?: number;

  @ApiPropertyOptional({ minimum: 0, maximum: 1, default: 0.5 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  confidence?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}
