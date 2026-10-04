import { ApiProperty } from '@nestjs/swagger';
import { IsObject } from 'class-validator';

export class UpdateSkillConfigDto {
  @ApiProperty({ type: 'object', additionalProperties: { type: 'string' } })
  @IsObject()
  config!: Record<string, unknown>;
}
