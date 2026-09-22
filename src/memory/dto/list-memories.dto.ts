import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { MEMORY_KINDS, MEMORY_SCOPES, MEMORY_SPACES, MEMORY_STATUSES } from '../memory.types.js';

export class ListMemoriesQueryDto {
  @ApiPropertyOptional({ enum: MEMORY_SCOPES })
  @IsOptional()
  @IsIn(MEMORY_SCOPES)
  scope?: string;

  @ApiPropertyOptional({ enum: MEMORY_SPACES })
  @IsOptional()
  @IsIn(MEMORY_SPACES)
  space?: string;

  @ApiPropertyOptional({ enum: MEMORY_KINDS })
  @IsOptional()
  @IsIn(MEMORY_KINDS)
  kind?: string;

  @ApiPropertyOptional({ enum: MEMORY_STATUSES })
  @IsOptional()
  @IsIn(MEMORY_STATUSES)
  status?: string;

  @ApiPropertyOptional({ description: 'Case-insensitive text search over content' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  search?: string;
}
