import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsString, MinLength } from 'class-validator';
import { CONTACT_IDENTITY_TYPES, type ContactIdentityType } from '../contact.types.js';

export class AddContactIdentityDto {
  @ApiProperty({ enum: CONTACT_IDENTITY_TYPES })
  @IsIn(CONTACT_IDENTITY_TYPES)
  type: ContactIdentityType;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  value: string;
}
