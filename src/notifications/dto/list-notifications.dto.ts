import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';

export class ListNotificationsQueryDto {
  @ApiPropertyOptional({ enum: ['unread', 'read'] })
  @IsOptional()
  @IsIn(['unread', 'read'])
  status?: 'unread' | 'read';
}
