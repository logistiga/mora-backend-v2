import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsIn, IsInt, IsOptional, IsString, MinLength } from 'class-validator';

export class CreateEmailAccountDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  label: string;

  @ApiProperty()
  @IsEmail()
  address: string;

  @ApiProperty({ enum: ['imap_smtp', 'gmail', 'microsoft_graph'] })
  @IsIn(['imap_smtp', 'gmail', 'microsoft_graph'])
  provider: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  imapHost?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  imapPort?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  smtpHost?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  smtpPort?: number;

  @ApiPropertyOptional({ description: 'IMAP/SMTP username, if different from address' })
  @IsOptional()
  @IsString()
  username?: string;

  @ApiPropertyOptional({ description: 'Password/app-password — never returned by any endpoint' })
  @IsOptional()
  @IsString()
  password?: string;
}
