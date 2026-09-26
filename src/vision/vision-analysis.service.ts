import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { LlmCallLogger } from '../ai-providers/llm-call-logger.service.js';
import { VisionProviderResolverService } from './providers/vision-provider-resolver.service.js';
import { VisionProviderRegistry } from './providers/vision-provider-registry.service.js';
import type { VisionSourceType } from './vision.types.js';

@Injectable()
export class VisionAnalysisService {
  constructor(
    private readonly resolver: VisionProviderResolverService,
    private readonly registry: VisionProviderRegistry,
    private readonly llmCallLogger: LlmCallLogger,
  ) {}

  async analyzeImage(params: {
    userId: string;
    scope: string;
    space: string;
    sourceType: VisionSourceType;
    originalFilename: string;
    userPrompt?: string;
    mimeType: string;
    buffer: Buffer;
  }) {
    const connection = await this.resolver.resolve(params.userId, { scope: params.scope, space: params.space });
    if (!connection) {
      throw new ServiceUnavailableException('No vision-capable AI provider is configured for this scope/space');
    }

    const provider = this.registry.get(connection.provider);
    if (!provider) {
      throw new ServiceUnavailableException(`No vision adapter is registered for provider "${connection.provider}"`);
    }

    const started = Date.now();
    try {
      const result = await provider.analyze(connection, {
        prompt: buildVisionPrompt(params),
        images: [{ mimeType: params.mimeType, buffer: params.buffer }],
      });

      await this.llmCallLogger.log({
        userId: params.userId,
        providerId: connection.providerRowId,
        kind: 'vision',
        model: result.model,
        scope: params.scope,
        space: params.space,
        latencyMs: Date.now() - started,
        status: 'success',
        promptTokens: result.promptTokens,
        completionTokens: result.completionTokens,
        totalTokens: result.totalTokens,
      });

      return result;
    } catch (error) {
      await this.llmCallLogger.log({
        userId: params.userId,
        providerId: connection.providerRowId,
        kind: 'vision',
        model: connection.model,
        scope: params.scope,
        space: params.space,
        latencyMs: Date.now() - started,
        status: 'error',
        errorCode: error instanceof Error ? error.message.slice(0, 100) : 'vision_error',
      });
      throw error;
    }
  }
}

function buildVisionPrompt(params: {
  sourceType: VisionSourceType;
  originalFilename: string;
  userPrompt?: string;
}): string {
  const userPrompt = params.userPrompt?.trim();
  return (
    `Source: ${params.sourceType}. Fichier: ${params.originalFilename}. ` +
    (userPrompt ? `Demande utilisateur: ${userPrompt}. ` : '') +
    'Analyse cette image pour aider Mora a repondre ensuite a l utilisateur. ' +
    'Decris fidelement les elements visibles, extrais le texte lisible, et si une structure claire ' +
    'apparait (facture, tableau, formulaire, liste), mets les informations utiles dans structuredData.'
  );
}
