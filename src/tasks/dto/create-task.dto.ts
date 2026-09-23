import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsISO8601, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { TASK_PRIORITIES, TASK_SCOPES, type TaskPriority } from '../task.types.js';

export class CreateTaskDto {
  @ApiProperty({ enum: TASK_SCOPES })
  @IsIn(TASK_SCOPES)
  scope: 'personal' | 'professional';

  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  space: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  description?: string;

  @ApiPropertyOptional({ enum: TASK_PRIORITIES, default: 'normal' })
  @IsOptional()
  @IsIn(TASK_PRIORITIES)
  priority?: TaskPriority;

  @ApiPropertyOptional({ description: 'ISO 8601 date-time' })
  @IsOptional()
  @IsISO8601()
  dueAt?: string;
}
