import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';

/** Internal shape used by UsersService.create(); password is already hashed by the caller. */
export class CreateUserDto {
  @IsEmail()
  email: string;

  @IsString()
  @MinLength(60) // bcrypt hash length
  passwordHash: string;

  @IsString()
  @MinLength(1)
  @MaxLength(120)
  displayName: string;
}
