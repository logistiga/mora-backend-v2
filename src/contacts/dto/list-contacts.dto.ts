import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString } from 'class-validator';
import { CONTACT_SCOPES, TRUST_LEVELS, type TrustLevel } from '../contact.types.js';

export class ListContactsQueryDto {
  @ApiPropertyOptional({ enum: CONTACT_SCOPES })
  @IsOptional()
  @IsIn(CONTACT_SCOPES)
  scope?: 'personal' | 'professional';

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  space?: string;

  @ApiPropertyOptional({ enum: TRUST_LEVELS })
  @IsOptional()
  @IsIn(TRUST_LEVELS)
  trustLevel?: TrustLevel;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  search?: string;
}
