import { ApiProperty } from '@nestjs/swagger';
import { IsIn } from 'class-validator';

const BUG_REPORT_STATUSES = ['open', 'investigating', 'resolved', 'ignored'] as const;

export class UpdateBugReportDto {
  @ApiProperty({ enum: BUG_REPORT_STATUSES })
  @IsIn(BUG_REPORT_STATUSES)
  status: (typeof BUG_REPORT_STATUSES)[number];
}
