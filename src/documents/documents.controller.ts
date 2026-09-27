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
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import type { AuthenticatedUser } from '../auth/entities/token-payload.interface.js';
import { JwtAccessGuard } from '../auth/guards/jwt-access.guard.js';
import { DocumentService } from './document.service.js';
import { ListDocumentsQueryDto } from './dto/list-documents.dto.js';
import { UpdateDocumentDto } from './dto/update-document.dto.js';
import { UploadDocumentDto } from './dto/upload-document.dto.js';
import { toDocumentPublicView } from './document.view.js';

@ApiTags('documents')
@ApiBearerAuth()
@UseGuards(JwtAccessGuard)
@Controller('documents')
export class DocumentsController {
  constructor(private readonly documentService: DocumentService) {}

  @Post()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'Upload a document',
    description:
      'Multipart upload. The binary part MUST be named `file` (single file per request). ' +
      'Maximum size: 25 MiB (26214400 bytes) — a larger file is rejected with 400. ' +
      'Accepted file extensions (the extension is what is validated, not the MIME type): ' +
      '`.pdf`, `.docx`, `.txt`, `.md`, `.csv`, `.xlsx`. Images go through `/vision`, not here. ' +
      'Re-uploading a byte-identical file in the same scope/space is deduplicated: the ' +
      'existing document is returned with 201 instead of creating a second copy. ' +
      'Rate limit: 10 uploads per minute.',
  })
  @ApiBody({
    required: true,
    schema: {
      type: 'object',
      required: ['file'],
      properties: {
        file: { type: 'string', format: 'binary', description: 'The document (max 25 MiB)' },
        scope: { type: 'string', enum: ['personal', 'professional'] },
        space: { type: 'string' },
      },
    },
  })
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
    const document = await this.documentService.upload({
      userId: user.id,
      scope: dto.scope,
      space: dto.space,
      originalFilename: file.originalname,
      mimeType: file.mimetype,
      buffer: file.buffer,
    });
    return toDocumentPublicView(document);
  }

  @Get()
  async list(@CurrentUser() user: AuthenticatedUser, @Query() query: ListDocumentsQueryDto) {
    const documents = await this.documentService.list(user.id, query);
    return documents.map(toDocumentPublicView);
  }

  @Get(':id')
  async getOne(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    const details = await this.documentService.getWithDetails(user.id, id);
    return { ...details, document: toDocumentPublicView(details.document) };
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
    return toDocumentPublicView(await this.documentService.reprocess(user.id, id));
  }

  @Patch(':id')
  async update(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: UpdateDocumentDto) {
    return toDocumentPublicView(await this.documentService.update(user.id, id, dto));
  }

  @Post(':id/archive')
  async archive(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return toDocumentPublicView(await this.documentService.archive(user.id, id));
  }
}
