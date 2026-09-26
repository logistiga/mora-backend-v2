import { Injectable } from '@nestjs/common';
import type { ResolvedProviderConnection } from '../../ai-providers/ai-provider.types.js';
import { AiProviderService } from '../../ai-providers/ai-provider.service.js';

@Injectable()
export class VisionProviderResolverService {
  constructor(private readonly aiProviderService: AiProviderService) {}

  async resolve(
    userId: string,
    params: { scope: string; space: string },
  ): Promise<ResolvedProviderConnection | null> {
    const dedicated = await this.aiProviderService.getProviderForUseCase(userId, {
      kind: 'vision',
      scope: params.scope,
      space: params.space,
    });
    if (dedicated) return this.aiProviderService.toConnection(dedicated);

    const chat = await this.aiProviderService.getProviderForUseCase(userId, {
      kind: 'chat',
      scope: params.scope,
      space: params.space,
    });
    if (!chat) return null;

    const connection = this.aiProviderService.toConnection(chat);
    return connection.capabilities.vision ? connection : null;
  }
}
