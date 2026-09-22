import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString } from 'class-validator';

export class ListAiProvidersQueryDto {
  @ApiPropertyOptional({ description: 'chat|embedding|vision|stt|tts|image|avatar|...' })
  @IsOptional()
  @IsString()
  kind?: string;

  @ApiPropertyOptional({ enum: ['personal', 'professional'] })
  @IsOptional()
  @IsIn(['personal', 'professional'])
  scope?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  space?: string;

  @ApiPropertyOptional({ enum: ['true', 'false'] })
  @IsOptional()
  @IsIn(['true', 'false'])
  isActive?: string;
}
