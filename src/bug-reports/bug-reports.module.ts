import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { RolesGuard } from '../common/guards/roles.guard.js';
import { BugReportsController } from './bug-reports.controller.js';
import { BugReportsService } from './bug-reports.service.js';

@Module({
  imports: [PassportModule.register({ defaultStrategy: 'jwt-access' })],
  controllers: [BugReportsController],
  providers: [BugReportsService, RolesGuard],
})
export class BugReportsModule {}
