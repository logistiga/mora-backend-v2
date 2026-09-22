import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
  EmbeddingProviderInterface,
  EmbeddingResult,
} from '../embedding-provider.interface.js';

/**
 * Works against any OpenAI-compatible /v1/embeddings endpoint. Configured
 * purely via env — no hardcoded key. Never assumes a fixed output dimension
 * (e.g. 1536): it measures `embedding.length` from the real response.
 */
@Injectable()
export class OpenAiEmbeddingProvider implements EmbeddingProviderInterface {
  readonly name = 'openai-compatible';
  private readonly logger = new Logger(OpenAiEmbeddingProvider.name);

  private readonly enabled: boolean;
  private readonly apiKey?: string;
  private readonly baseUrl: string;
  private readonly model: string;

  constructor(configService: ConfigService) {
    this.enabled = configService.get<boolean>('app.embedding.enabled') ?? false;
    this.apiKey = configService.get<string>('app.embedding.apiKey') || undefined;
    this.baseUrl =
      configService.get<string>('app.embedding.baseUrl') || 'https://api.openai.com/v1';
    this.model = configService.get<string>('app.embedding.model') || 'text-embedding-3-small';
  }

  isConfigured(): boolean {
    return this.enabled && Boolean(this.apiKey);
  }

  async embed(text: string): Promise<EmbeddingResult> {
    if (!this.isConfigured()) {
      throw new Error('OpenAiEmbeddingProvider is not configured (MORA_EMBEDDING_API_KEY missing or MORA_EMBEDDING_ENABLED=false)');
    }

    const response = await fetch(`${this.baseUrl}/embeddings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({ model: this.model, input: text }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      this.logger.error(`Embedding request failed: ${response.status} ${body}`);
      throw new Error(`Embedding provider request failed with status ${response.status}`);
    }

    const data = (await response.json()) as {
      data?: { embedding?: number[] }[];
      model?: string;
    };
    const embedding = data.data?.[0]?.embedding;
    if (!embedding || embedding.length === 0) {
      throw new Error('Embedding provider returned an empty embedding');
    }

    return { embedding, model: data.model ?? this.model, dimensions: embedding.length };
  }
}
