import { Injectable, Logger } from '@nestjs/common';
import type { ResolvedProviderConnection } from '../ai-provider.types.js';
import type { EmbeddingAdapterResult, EmbeddingProviderAdapter } from './embedding-adapter.interface.js';

const DEFAULT_BASE_URL = 'https://api.openai.com/v1';

@Injectable()
export class OpenAiCompatibleEmbeddingAdapter implements EmbeddingProviderAdapter {
  readonly supportedProviders = ['openai', 'openrouter', 'ollama', 'custom_openai_compatible'] as const;

  private readonly logger = new Logger(OpenAiCompatibleEmbeddingAdapter.name);

  async embed(connection: ResolvedProviderConnection, text: string): Promise<EmbeddingAdapterResult> {
    const baseUrl = connection.baseUrl || DEFAULT_BASE_URL;
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (connection.apiKey) {
      headers.Authorization = `Bearer ${connection.apiKey}`;
    }

    const response = await fetch(`${baseUrl}/embeddings`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ model: connection.model, input: text }),
      signal: connection.settings.timeoutMs
        ? AbortSignal.timeout(connection.settings.timeoutMs)
        : undefined,
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      this.logger.warn(`Embedding provider request failed: ${response.status}`);
      throw new Error(
        `Embedding provider request failed with status ${response.status}: ${truncate(body)}`,
      );
    }

    const data = (await response.json()) as { data?: { embedding?: number[] }[]; model?: string };
    const embedding = data.data?.[0]?.embedding;
    if (!embedding || embedding.length === 0) {
      throw new Error('Embedding provider returned an empty embedding');
    }

    return { embedding, model: data.model ?? connection.model, dimensions: embedding.length };
  }
}

function truncate(text: string, max = 300): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}
