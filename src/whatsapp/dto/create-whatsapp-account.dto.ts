import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsObject, IsOptional, IsString, MinLength } from 'class-validator';

export class CreateWhatsAppAccountDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  label: string;

  @ApiProperty()
  @IsString()
  @MinLength(6)
  phoneNumber: string;

  @ApiProperty({ enum: ['evolution', 'meta_cloud'] })
  @IsIn(['evolution', 'meta_cloud'])
  provider: string;

  // Provider-specific connection details, e.g. { baseUrl, instanceId }, kept
  // outside `credentials` (secret) — non-secret config, safe to read back.
  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  config?: Record<string, unknown>;

  @ApiPropertyOptional({ description: 'Evolution API key / access token — never returned by any endpoint' })
  @IsOptional()
  @IsString()
  apiKey?: string;
}
