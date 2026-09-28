import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export class ListNotificationsQueryDto {
  @ApiPropertyOptional({ enum: ['unread', 'read'] })
  @IsOptional()
  @IsIn(['unread', 'read'])
  status?: 'unread' | 'read';

  @ApiPropertyOptional({ description: "Filter on the notification type, e.g. 'reminder'" })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  type?: string;
}
