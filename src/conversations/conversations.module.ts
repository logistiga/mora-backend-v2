import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { ConversationsController } from './conversations.controller.js';
import { ConversationsService } from './conversations.service.js';
import { RouterDecisionsController } from './router-decisions.controller.js';
import { RouterDecisionsService } from './router-decisions.service.js';

@Module({
  imports: [PassportModule.register({ defaultStrategy: 'jwt-access' })],
  controllers: [ConversationsController, RouterDecisionsController],
  providers: [ConversationsService, RouterDecisionsService],
  exports: [ConversationsService, RouterDecisionsService],
})
export class ConversationsModule {}
