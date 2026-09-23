import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class ListWhatsAppConversationsQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  accountId?: string;
}
