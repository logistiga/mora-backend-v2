import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsString, MinLength } from 'class-validator';
import { DOCUMENT_SCOPES } from '../document.types.js';

export class UploadDocumentDto {
  @ApiProperty({ enum: DOCUMENT_SCOPES })
  @IsIn(DOCUMENT_SCOPES)
  scope: 'personal' | 'professional';

  @ApiProperty()
  @IsString()
  @MinLength(1)
  space: string;
}
