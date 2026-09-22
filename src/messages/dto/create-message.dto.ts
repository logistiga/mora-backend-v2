import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

export class CreateMessageDto {
  @ApiProperty({ example: 'Peux-tu me rappeler mon rendez-vous demain ?' })
  @IsString()
  @MinLength(1)
  @MaxLength(8000)
  message: string;

  @ApiPropertyOptional({ description: 'Existing conversation to continue; omit to start a new one' })
  @IsOptional()
  @IsUUID()
  conversationId?: string;
}
