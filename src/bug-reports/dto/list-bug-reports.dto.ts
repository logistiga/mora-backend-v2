import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

const BUG_REPORT_STATUSES = ['open', 'investigating', 'resolved', 'ignored'] as const;

export class ListBugReportsDto {
  @ApiPropertyOptional({ enum: BUG_REPORT_STATUSES })
  @IsOptional()
  @IsIn(BUG_REPORT_STATUSES)
  status?: (typeof BUG_REPORT_STATUSES)[number];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  userId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  requestId?: string;

  @ApiPropertyOptional({ default: 50 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 50;
}
