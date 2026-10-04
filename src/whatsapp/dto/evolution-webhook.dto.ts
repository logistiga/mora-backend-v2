import { IsObject, IsOptional, IsString } from 'class-validator';

/**
 * Evolution API sends more top-level fields than just event and data
 * (instance, sender, date_time, server_url, destination, apikey). The global
 * ValidationPipe rejects unknown properties, so every field Evolution really
 * sends must be declared here. Only event and data are used; the others are
 * accepted and ignored, and `apikey` is never logged or stored.
 */
export class EvolutionWebhookDto {
  @IsOptional()
  @IsString()
  event?: string;

  @IsOptional()
  @IsObject()
  data?: Record<string, unknown>;

  @IsOptional()
  @IsString()
  instance?: string;

  @IsOptional()
  @IsString()
  sender?: string;

  @IsOptional()
  @IsString()
  date_time?: string;

  @IsOptional()
  @IsString()
  server_url?: string;

  @IsOptional()
  @IsString()
  destination?: string;

  @IsOptional()
  @IsString()
  apikey?: string;
}
