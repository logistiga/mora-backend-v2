import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import type { AuthenticatedUser } from '../auth/entities/token-payload.interface.js';
import { JwtAccessGuard } from '../auth/guards/jwt-access.guard.js';
import { DocumentService } from './document.service.js';
import { ListDocumentsQueryDto } from './dto/list-documents.dto.js';
import { UpdateDocumentDto } from './dto/update-document.dto.js';
import { UploadDocumentDto } from './dto/upload-document.dto.js';

@ApiTags('documents')
@ApiBearerAuth()
@UseGuards(JwtAccessGuard)
@Controller('documents')
export class DocumentsController {
  constructor(private readonly documentService: DocumentService) {}

  @Post()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiConsumes('multipart/form-data')
  // Multer's own limit is a coarse first line of defense (static, evaluated
  // at decorator time); DocumentService.upload() re-checks against the
  // configurable app.documents.maxUploadBytes, which is the real authority.
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 26_214_400 } }))
  async upload(
    @CurrentUser() user: AuthenticatedUser,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() dto: UploadDocumentDto,
  ) {
    if (!file) {
      throw new BadRequestException('No file provided (expected multipart field "file")');
    }
    return this.documentService.upload({
      userId: user.id,
      scope: dto.scope,
      space: dto.space,
      originalFilename: file.originalname,
      mimeType: file.mimetype,
      buffer: file.buffer,
    });
  }

  @Get()
  async list(@CurrentUser() user: AuthenticatedUser, @Query() query: ListDocumentsQueryDto) {
    return this.documentService.list(user.id, query);
  }

  @Get(':id')
  async getOne(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.documentService.getWithDetails(user.id, id);
  }

  @Get(':id/status')
  async status(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    const document = await this.documentService.getById(user.id, id);
    return {
      id: document.id,
      status: document.status,
      needsReview: document.needsReview,
      errorMessage: document.errorMessage,
      processedAt: document.processedAt,
    };
  }

  @Post(':id/reprocess')
  async reprocess(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.documentService.reprocess(user.id, id);
  }

  @Patch(':id')
  async update(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: UpdateDocumentDto) {
    return this.documentService.update(user.id, id, dto);
  }

  @Post(':id/archive')
  async archive(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.documentService.archive(user.id, id);
  }
}
