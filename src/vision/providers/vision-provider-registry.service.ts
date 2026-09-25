import { Injectable } from '@nestjs/common';
import { OpenAiCompatibleVisionProvider } from './openai-compatible-vision.provider.js';
import type { VisionProviderInterface } from '../vision-provider.interface.js';

@Injectable()
export class VisionProviderRegistry {
  private readonly providers: VisionProviderInterface[];

  constructor(openAiCompatible: OpenAiCompatibleVisionProvider) {
    this.providers = [openAiCompatible];
  }

  get(providerName: string): VisionProviderInterface | null {
    return this.providers.find((provider) => provider.supportedProviders.includes(providerName)) ?? null;
  }
}
