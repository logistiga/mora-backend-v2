import { Module } from '@nestjs/common';
import { LlmModule } from '../llm/llm.module.js';
import { MoraRouterService } from './mora-router.service.js';

@Module({
  imports: [LlmModule],
  providers: [MoraRouterService],
  exports: [MoraRouterService],
})
export class RouterModule {}
