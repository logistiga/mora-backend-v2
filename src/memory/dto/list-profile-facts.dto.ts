import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';
import { MEMORY_SCOPES, MEMORY_SPACES } from '../memory.types.js';
import { ESSENTIAL_SCOPE, ESSENTIAL_SPACE } from '../profile-facts.service.js';

const PROFILE_FACT_STATUSES = ['active', 'archived', 'superseded'];
// Learning-core phase: the Essential User Profile (see ProfileFactsService)
// reuses this same table/endpoint with a reserved scope/space value, so a
// user can see/manage those facts through the existing API — no separate
// endpoint (AGENTS learning-core §11: no duplicate competing storage/API).
const LISTABLE_SCOPES = [...MEMORY_SCOPES, ESSENTIAL_SCOPE];
const LISTABLE_SPACES = [...MEMORY_SPACES, ESSENTIAL_SPACE];

export class ListProfileFactsQueryDto {
  @ApiPropertyOptional({ enum: LISTABLE_SCOPES })
  @IsOptional()
  @IsIn(LISTABLE_SCOPES)
  scope?: string;

  @ApiPropertyOptional({ enum: LISTABLE_SPACES })
  @IsOptional()
  @IsIn(LISTABLE_SPACES)
  space?: string;

  @ApiPropertyOptional({ enum: PROFILE_FACT_STATUSES })
  @IsOptional()
  @IsIn(PROFILE_FACT_STATUSES)
  status?: string;
}
