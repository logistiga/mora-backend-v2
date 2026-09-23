import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString } from 'class-validator';
import { TASK_SCOPES, TASK_STATUSES, type TaskStatus } from '../task.types.js';

export class ListTasksQueryDto {
  @ApiPropertyOptional({ enum: TASK_SCOPES })
  @IsOptional()
  @IsIn(TASK_SCOPES)
  scope?: 'personal' | 'professional';

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  space?: string;

  @ApiPropertyOptional({ enum: TASK_STATUSES })
  @IsOptional()
  @IsIn(TASK_STATUSES)
  status?: TaskStatus;
}
