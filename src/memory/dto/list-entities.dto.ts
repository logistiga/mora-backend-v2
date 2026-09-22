import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';
import { MEMORY_SCOPES, MEMORY_SPACES } from '../memory.types.js';

const ENTITY_TYPES = ['person', 'company', 'client', 'project', 'place', 'equipment', 'object'];

export class ListEntitiesQueryDto {
  @ApiPropertyOptional({ enum: MEMORY_SCOPES })
  @IsOptional()
  @IsIn(MEMORY_SCOPES)
  scope?: string;

  @ApiPropertyOptional({ enum: MEMORY_SPACES })
  @IsOptional()
  @IsIn(MEMORY_SPACES)
  space?: string;

  @ApiPropertyOptional({ enum: ENTITY_TYPES })
  @IsOptional()
  @IsIn(ENTITY_TYPES)
  type?: string;
}
