import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUrl,
  Min,
  MinLength,
} from 'class-validator';
import { KNOWN_PROVIDERS } from '../ai-provider.types.js';

export class CreateAiProviderDto {
  @ApiProperty({ example: 'My OpenAI' })
  @IsString()
  @MinLength(1)
  name: string;

  @ApiProperty({ example: 'openai', description: `Common values: ${KNOWN_PROVIDERS.join(', ')} (not restricted — any string is accepted for forward compatibility)` })
  @IsString()
  @MinLength(1)
  provider: string;

  @ApiProperty({ example: 'chat', description: 'chat|embedding|vision|stt|tts|image|avatar|... (extensible, not a closed enum)' })
  @IsString()
  @MinLength(1)
  kind: string;

  @ApiPropertyOptional({ example: 'https://api.openai.com/v1' })
  @IsOptional()
  @IsUrl({ require_tld: false, require_protocol: true }) // allow http://localhost:... for local/self-hosted providers, but always require a scheme
  baseUrl?: string;

  @ApiProperty({ example: 'gpt-4o-mini' })
  @IsString()
  @MinLength(1)
  model: string;

  @ApiPropertyOptional({ description: 'Plaintext API key — encrypted at rest immediately, never returned again. Omit for providers that need no auth (e.g. a local Ollama endpoint).' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  apiKey?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ description: 'If true, unsets any other default for the same (kind, scope, space).' })
  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;

  @ApiPropertyOptional({ enum: ['personal', 'professional'] })
  @IsOptional()
  @IsIn(['personal', 'professional'])
  scope?: string;

  @ApiPropertyOptional({ enum: ['personal', 'general', 'logistiga', 'piston', 'code'] })
  @IsOptional()
  @IsString()
  space?: string;

  @ApiPropertyOptional({ example: { chat: true, tools: true, streaming: true } })
  @IsOptional()
  @IsObject()
  capabilities?: Record<string, unknown>;

  @ApiPropertyOptional({ example: { maxTokens: 1024, timeoutMs: 30000 } })
  @IsOptional()
  @IsObject()
  settings?: Record<string, unknown>;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  priority?: number;
}
