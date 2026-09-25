import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { AuthenticatedUser } from '../auth/entities/token-payload.interface.js';
import { JwtAccessGuard } from '../auth/guards/jwt-access.guard.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import { Roles } from '../common/decorators/roles.decorator.js';
import { RolesGuard } from '../common/guards/roles.guard.js';
import { BugReportsService } from './bug-reports.service.js';
import { CreateBugReportDto } from './dto/create-bug-report.dto.js';
import { ListBugReportsDto } from './dto/list-bug-reports.dto.js';
import { UpdateBugReportDto } from './dto/update-bug-report.dto.js';

@ApiTags('bug-reports')
@ApiBearerAuth()
@UseGuards(JwtAccessGuard)
@Controller('bug-reports')
export class BugReportsController {
  constructor(private readonly bugReports: BugReportsService) {}

  @Post()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateBugReportDto,
  ) {
    return this.bugReports.create(user, dto);
  }

  @Get()
  @Roles('ADMIN')
  @UseGuards(RolesGuard)
  async list(@Query() query: ListBugReportsDto) {
    return this.bugReports.list(query);
  }

  @Patch(':id')
  @Roles('ADMIN')
  @UseGuards(RolesGuard)
  async update(@Param('id') id: string, @Body() dto: UpdateBugReportDto) {
    return this.bugReports.update(id, dto);
  }
}
