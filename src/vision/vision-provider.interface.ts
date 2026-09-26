import type { ResolvedProviderConnection } from '../ai-providers/ai-provider.types.js';

export interface VisionProviderRequest {
  prompt: string;
  images: { mimeType: string; buffer: Buffer }[];
}

export interface VisionProviderResult {
  summary: string;
  extractedText: string;
  structuredData: Record<string, unknown> | null;
  provider: string;
  model: string;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
}

export interface VisionProviderInterface {
  readonly supportedProviders: readonly string[];

  analyze(connection: ResolvedProviderConnection, request: VisionProviderRequest): Promise<VisionProviderResult>;
}
