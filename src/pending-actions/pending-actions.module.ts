import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { AuditModule } from '../audit/audit.module.js';
import { ToolsModule } from '../tools/tools.module.js';
import { PendingActionService } from './pending-action.service.js';
import { PendingActionsController } from './pending-actions.controller.js';

@Module({
  imports: [ToolsModule, AuditModule, PassportModule.register({ defaultStrategy: 'jwt-access' })],
  controllers: [PendingActionsController],
  providers: [PendingActionService],
  exports: [PendingActionService],
})
export class PendingActionsModule {}
