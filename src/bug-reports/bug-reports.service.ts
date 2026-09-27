import {
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { RequestContextService } from '../common/http/request-context.service.js';
import { PrismaService } from '../database/prisma.service.js';
import type { AuthenticatedUser } from '../auth/entities/token-payload.interface.js';
import type { BugReport, Prisma } from '../generated/prisma/client.js';
import { sanitizeBugReportMetadata, sanitizeBugReportText } from './bug-report-sanitizer.util.js';
import type { CreateBugReportDto } from './dto/create-bug-report.dto.js';
import type { ListBugReportsDto } from './dto/list-bug-reports.dto.js';
import type { UpdateBugReportDto } from './dto/update-bug-report.dto.js';

@Injectable()
export class BugReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly requestContext: RequestContextService,
  ) {}

  async create(user: AuthenticatedUser, dto: CreateBugReportDto): Promise<BugReport> {
    const context = this.requestContext.get();

    // `requestId`/`apiRoute` identify the request the user is REPORTING, so
    // they only ever come from the client. Defaulting them to the current
    // request context would silently attach the bug report's own POST
    // /bug-reports call — an id that leads investigators to the report
    // instead of the failure. The report's own context is kept separately
    // under metadata.report for traceability.
    const sanitizedMetadata = sanitizeBugReportMetadata(dto.metadata);
    const metadata = {
      ...sanitizedMetadata,
      report: { requestId: context?.requestId ?? null, path: context?.path ?? null },
    } as Prisma.InputJsonValue;

    return this.prisma.bugReport.create({
      data: {
        userId: user.id,
        requestId: dto.requestId ?? null,
        conversationId: dto.conversationId,
        voiceSessionId: dto.voiceSessionId,
        category: dto.category,
        severity: dto.severity,
        title: sanitizeBugReportText(dto.title) ?? 'Untitled bug report',
        description: sanitizeBugReportText(dto.description) ?? 'No description',
        frontendRoute: sanitizeBugReportText(dto.frontendRoute),
        apiRoute: sanitizeBugReportText(dto.apiRoute),
        browserInfo: sanitizeBugReportText(dto.browserInfo),
        appVersion: sanitizeBugReportText(dto.appVersion),
        metadata,
        status: 'open',
      },
    });
  }

  async list(query: ListBugReportsDto): Promise<BugReport[]> {
    return this.prisma.bugReport.findMany({
      where: {
        status: query.status,
        userId: query.userId,
        requestId: query.requestId,
      },
      orderBy: { createdAt: 'desc' },
      take: query.limit ?? 50,
    });
  }

  async update(id: string, dto: UpdateBugReportDto): Promise<BugReport> {
    const report = await this.prisma.bugReport.findUnique({ where: { id } });
    if (!report) throw new NotFoundException('Bug report not found');

    return this.prisma.bugReport.update({
      where: { id },
      data: { status: dto.status },
    });
  }
}
