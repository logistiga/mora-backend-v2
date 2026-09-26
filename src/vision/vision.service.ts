import { BadRequestException, Injectable } from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import type { AuthenticatedUser } from '../auth/entities/token-payload.interface.js';
import { ConversationsService } from '../conversations/conversations.service.js';
import { MoraOrchestratorService } from '../orchestrator/mora-orchestrator.service.js';
import type { RouterDecisionResult } from '../router/router.types.js';
import { UsersService } from '../users/users.service.js';
import type { AnalyzeVisionDto } from './dto/analyze-vision.dto.js';
import { VisionAnalysisService } from './vision-analysis.service.js';
import { VisionAssetService } from './vision-asset.service.js';
import { buildVisionContextNote } from './vision-context.util.js';
import { VisionProviderResolverService } from './providers/vision-provider-resolver.service.js';
import type { VisionContextNoteInput, VisionSourceType } from './vision.types.js';

@Injectable()
export class VisionService {
  constructor(
    private readonly conversationsService: ConversationsService,
    private readonly usersService: UsersService,
    private readonly visionAssets: VisionAssetService,
    private readonly visionAnalysis: VisionAnalysisService,
    private readonly visionResolver: VisionProviderResolverService,
    private readonly orchestrator: MoraOrchestratorService,
    private readonly audit: AuditService,
  ) {}

  async analyze(
    user: AuthenticatedUser,
    dto: AnalyzeVisionDto,
    files: Express.Multer.File[],
  ) {
    if (files.length === 0) throw new BadRequestException('No image provided (expected multipart field "files")');
    if (files.length > this.visionAssets.getLimits().maxFiles) throw new BadRequestException('Too many images in one request');

    const conversation = await this.conversationsService.getOrCreateConversation(user.id, dto.conversationId);
    const sourceType = (dto.sourceType ?? 'upload') as VisionSourceType;
    const channel = sourceType === 'voice_snapshot' ? 'voice_vision' : 'vision';
    const targetSpace = normalizeTargetSpace(dto.scope, dto.space);
    const analyzedAssets: { id: string; note: VisionContextNoteInput }[] = [];

    for (const file of files) {
      const { asset } = await this.visionAssets.createOrReuse({
        userId: user.id,
        conversationId: conversation.id,
        scope: dto.scope,
        space: targetSpace,
        sourceType,
        originalFilename: file.originalname,
        buffer: file.buffer,
      });

      const summary =
        asset.status === 'analyzed' && asset.summary
          ? asset
          : await this.analyzeAndPersistAsset(user.id, dto.scope, targetSpace, sourceType, asset.id, dto.message);

      analyzedAssets.push({
        id: summary.id,
        note: {
          sourceType,
          originalFilename: summary.originalFilename,
          summary: summary.summary ?? '',
          extractedText: summary.extractedText ?? '',
          structuredData: extractStructuredData(summary.analysis),
          width: summary.width,
          height: summary.height,
        },
      });
    }

    const fullUser = await this.usersService.findById(user.id);
    const visionContextSummary = buildVisionContextNote(analyzedAssets.map((asset) => asset.note));
    const result = await this.orchestrator.handleMessage({
      user: { id: user.id, email: user.email, displayName: fullUser?.displayName ?? user.email },
      message: dto.message,
      conversationId: conversation.id,
      channel,
      externalContextNotes: [visionContextSummary],
      routingOverride: {
        route: dto.scope,
        scope: dto.scope,
        space: targetSpace,
      },
      userMessageMetadata: {
        channel,
        sourceType,
        visionAssetIds: analyzedAssets.map((asset) => asset.id),
        visionContextSummary,
      },
    });

    await this.visionAssets.attachToMessage(user.id, analyzedAssets.map((asset) => asset.id), result.userMessageId);
    await this.audit.log({
      userId: user.id,
      conversationId: result.conversationId,
      action: 'vision_turn_processed',
      scope: dto.scope,
      space: targetSpace,
      metadata: { userMessageId: result.userMessageId, assetIds: analyzedAssets.map((asset) => asset.id), sourceType },
    });

    return {
      ...result,
      assets: analyzedAssets.map((asset) => ({ id: asset.id, ...asset.note })),
    };
  }

  async getStatus(userId: string, params: { scope: string; space: string }) {
    const limits = this.visionAssets.getLimits();
    const configured = await this.visionResolver.resolve(userId, { scope: params.scope, space: normalizeTargetSpace(params.scope, params.space) });
    return {
      visionConfigured: configured !== null,
      provider: configured ? { provider: configured.provider, model: configured.model, kind: configured.kind } : null,
      supportedMimeTypes: ['image/png', 'image/jpeg', 'image/webp'],
      maxFiles: limits.maxFiles,
      maxUploadBytes: limits.maxUploadBytes,
      features: { ocr: true, multimodalConversation: true, cameraSnapshot: true, screenshot: true },
    };
  }

  async getAsset(userId: string, id: string) {
    const asset = await this.visionAssets.getOwned(userId, id);
    return serializeVisionAsset(asset);
  }

  private async analyzeAndPersistAsset(
    userId: string,
    scope: string,
    space: string,
    sourceType: VisionSourceType,
    assetId: string,
    userPrompt: string,
  ) {
    const asset = await this.visionAssets.getOwned(userId, assetId);
    const buffer = await this.visionAssets.readBuffer(asset);
    try {
      const result = await this.visionAnalysis.analyzeImage({
        userId,
        scope,
        space,
        sourceType,
        originalFilename: asset.originalFilename,
        userPrompt,
        mimeType: asset.mimeType,
        buffer,
      });
      return this.visionAssets.markAnalyzed(asset.id, result);
    } catch (error) {
      await this.visionAssets.markFailed(asset.id, error instanceof Error ? error.message : String(error));
      throw error;
    }
  }
}

function extractStructuredData(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && 'structuredData' in value
    ? ((value as { structuredData?: Record<string, unknown> }).structuredData ?? null)
    : null;
}

function normalizeTargetSpace(scope: string, space: string): RouterDecisionResult['space'] {
  if (scope === 'personal') return 'personal';
  if (space === 'general' || space === 'logistiga' || space === 'piston' || space === 'code') return space;
  throw new BadRequestException(`Unsupported professional space: ${space}`);
}

function serializeVisionAsset(asset: {
  id: string;
  conversationId: string;
  messageId: string | null;
  scope: string;
  space: string;
  sourceType: string;
  originalFilename: string;
  mimeType: string;
  extension: string;
  sizeBytes: number;
  width: number | null;
  height: number | null;
  status: string;
  summary: string | null;
  extractedText: string | null;
  analysis: unknown;
  errorMessage: string | null;
  createdAt: Date;
  updatedAt: Date;
  analyzedAt: Date | null;
}) {
  return {
    id: asset.id,
    conversationId: asset.conversationId,
    messageId: asset.messageId,
    scope: asset.scope,
    space: asset.space,
    sourceType: asset.sourceType,
    originalFilename: asset.originalFilename,
    mimeType: asset.mimeType,
    extension: asset.extension,
    sizeBytes: asset.sizeBytes,
    width: asset.width,
    height: asset.height,
    status: asset.status,
    summary: asset.summary,
    extractedText: asset.extractedText,
    analysis: asset.analysis,
    errorMessage: asset.errorMessage,
    createdAt: asset.createdAt,
    updatedAt: asset.updatedAt,
    analyzedAt: asset.analyzedAt,
  };
}
