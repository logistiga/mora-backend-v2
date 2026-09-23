import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBooleanString, IsIn, IsOptional, IsString } from 'class-validator';
import { DOCUMENT_SCOPES, DOCUMENT_STATUSES } from '../document.types.js';

export class ListDocumentsQueryDto {
  @ApiPropertyOptional({ enum: DOCUMENT_SCOPES })
  @IsOptional()
  @IsIn(DOCUMENT_SCOPES)
  scope?: 'personal' | 'professional';

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  space?: string;

  @ApiPropertyOptional({ enum: DOCUMENT_STATUSES })
  @IsOptional()
  @IsIn(DOCUMENT_STATUSES)
  status?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  documentType?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  tag?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  source?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBooleanString()
  needsReview?: string;
}
