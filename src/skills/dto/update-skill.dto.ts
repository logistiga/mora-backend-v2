import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean } from 'class-validator';

export class UpdateSkillDto {
  // The app-wide ValidationPipe uses implicit conversion, which would turn the
  // string "false" into true. Read the raw value so only a real JSON boolean is accepted.
  @ApiProperty()
  @Transform(({ obj }: { obj: { enabled?: unknown } }) => obj.enabled)
  @IsBoolean()
  enabled!: boolean;
}
