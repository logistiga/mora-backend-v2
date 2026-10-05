import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { WhatsAppModule } from '../whatsapp/whatsapp.module.js';
import { McpController } from './mcp.controller.js';
import { McpService } from './mcp.service.js';

@Module({
  imports: [PassportModule.register({ defaultStrategy: 'jwt-access' }), WhatsAppModule],
  controllers: [McpController],
  providers: [McpService],
})
export class McpModule {}
