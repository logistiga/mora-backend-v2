import { BadRequestException, Body, Controller, Get, Param, Post, Query, UploadedFiles, UseGuards, UseInterceptors } from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import type { AuthenticatedUser } from '../auth/entities/token-payload.interface.js';
import { JwtAccessGuard } from '../auth/guards/jwt-access.guard.js';
import { AnalyzeVisionDto, VisionStatusQueryDto } from './dto/analyze-vision.dto.js';
import { VisionService } from './vision.service.js';

@ApiTags('vision')
@ApiBearerAuth()
@UseGuards(JwtAccessGuard)
@Controller('vision')
export class VisionController {
  constructor(private readonly visionService: VisionService) {}

  @Get('status')
  async status(@CurrentUser() user: AuthenticatedUser, @Query() query: VisionStatusQueryDto) {
    return this.visionService.getStatus(user.id, query);
  }

  @Post('analyze')
  @Throttle({ default: { limit: 6, ttl: 60_000 } })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FilesInterceptor('files', 4, { limits: { fileSize: 10 * 1024 * 1024 } }))
  async analyze(
    @CurrentUser() user: AuthenticatedUser,
    @UploadedFiles() files: Express.Multer.File[] | undefined,
    @Body() dto: AnalyzeVisionDto,
  ) {
    if (!files) throw new BadRequestException('No image provided (expected multipart field "files")');
    return this.visionService.analyze(user, dto, files);
  }

  @Get('assets/:id')
  async getAsset(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.visionService.getAsset(user.id, id);
  }
}
