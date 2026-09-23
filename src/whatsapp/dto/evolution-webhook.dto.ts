import { IsObject, IsOptional, IsString } from 'class-validator';

/**
 * Deliberately loose (Evolution API's webhook payload varies by event type)
 * — the controller extracts only the specific fields it understands
 * (AGENTS Phase E §27) and ignores/discards everything else rather than
 * trusting the payload shape blindly.
 */
export class EvolutionWebhookDto {
  @IsOptional()
  @IsString()
  event?: string;

  @IsOptional()
  @IsObject()
  data?: Record<string, unknown>;
}
