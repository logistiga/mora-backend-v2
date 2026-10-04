import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { SkillsController } from './skills.controller.js';
import { UserSkillsService } from './user-skills.service.js';

@Module({
  imports: [PassportModule.register({ defaultStrategy: 'jwt-access' })],
  controllers: [SkillsController],
  providers: [UserSkillsService],
  exports: [UserSkillsService],
})
export class SkillsModule {}
