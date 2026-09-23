import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { CONTACT_SCOPES, TRUST_LEVELS, type TrustLevel } from '../contact.types.js';

export class CreateContactDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  firstName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  lastName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  company?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  jobTitle?: string;

  @ApiProperty({ enum: CONTACT_SCOPES })
  @IsIn(CONTACT_SCOPES)
  scope: 'personal' | 'professional';

  @ApiProperty()
  @IsString()
  @MinLength(1)
  space: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  relationship?: string;

  @ApiPropertyOptional({ enum: TRUST_LEVELS, default: 'unknown' })
  @IsOptional()
  @IsIn(TRUST_LEVELS)
  trustLevel?: TrustLevel;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  tags?: string[];
}
