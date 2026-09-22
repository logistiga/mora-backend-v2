import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';
import { MEMORY_SCOPES, MEMORY_SPACES } from '../memory.types.js';

const PROFILE_FACT_STATUSES = ['active', 'archived', 'superseded'];

export class ListProfileFactsQueryDto {
  @ApiPropertyOptional({ enum: MEMORY_SCOPES })
  @IsOptional()
  @IsIn(MEMORY_SCOPES)
  scope?: string;

  @ApiPropertyOptional({ enum: MEMORY_SPACES })
  @IsOptional()
  @IsIn(MEMORY_SPACES)
  space?: string;

  @ApiPropertyOptional({ enum: PROFILE_FACT_STATUSES })
  @IsOptional()
  @IsIn(PROFILE_FACT_STATUSES)
  status?: string;
}
