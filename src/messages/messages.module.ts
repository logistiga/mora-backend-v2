import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { OrchestratorModule } from '../orchestrator/orchestrator.module.js';
import { UsersModule } from '../users/users.module.js';
import { MessagesController } from './messages.controller.js';

@Module({
  imports: [PassportModule.register({ defaultStrategy: 'jwt-access' }), OrchestratorModule, UsersModule],
  controllers: [MessagesController],
})
export class MessagesModule {}
