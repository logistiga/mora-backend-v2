import { Injectable, Logger } from '@nestjs/common';
import type { ResolvedProviderConnection } from '../ai-provider.types.js';
import type {
  ChatAdapterRequest,
  ChatAdapterResult,
  ChatProviderAdapter,
} from './chat-adapter.interface.js';

const DEFAULT_BASE_URL = 'https://api.openai.com/v1';

/**
 * Works against any OpenAI-compatible /chat/completions endpoint — OpenAI
 * itself, and (per AGENTS §8) also the initial adapter for provider values
 * that speak the same wire format: groq, deepseek, openrouter, ollama's
 * OpenAI shim, and 'custom_openai_compatible'. A genuinely different wire
 * format (Anthropic's native API, for example) gets its own adapter later
 * without touching this one or any caller.
 */
@Injectable()
export class OpenAiCompatibleChatAdapter implements ChatProviderAdapter {
  readonly supportedProviders = [
    'openai',
    'groq',
    'deepseek',
    'openrouter',
    'ollama',
    'custom_openai_compatible',
  ] as const;

  private readonly logger = new Logger(OpenAiCompatibleChatAdapter.name);

  async complete(
    connection: ResolvedProviderConnection,
    request: ChatAdapterRequest,
  ): Promise<ChatAdapterResult> {
    const baseUrl = connection.baseUrl || DEFAULT_BASE_URL;
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (connection.apiKey) {
      headers.Authorization = `Bearer ${connection.apiKey}`;
    }

    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: connection.model,
        messages: request.messages,
        temperature: request.temperature ?? 0.7,
        max_tokens: request.maxTokens ?? connection.settings.maxTokens ?? 512,
      }),
      signal: connection.settings.timeoutMs
        ? AbortSignal.timeout(connection.settings.timeoutMs)
        : undefined,
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      this.logger.warn(`Chat provider request failed: ${response.status}`);
      throw new Error(`Chat provider request failed with status ${response.status}: ${truncate(body)}`);
    }

    const data = (await response.json()) as {
      choices?: { message?: { content?: string } }[];
      model?: string;
      usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
    };
    const content = data.choices?.[0]?.message?.content ?? '';

    return {
      content,
      model: data.model ?? connection.model,
      promptTokens: data.usage?.prompt_tokens,
      completionTokens: data.usage?.completion_tokens,
      totalTokens: data.usage?.total_tokens,
    };
  }

  supportsTools(connection: ResolvedProviderConnection): boolean {
    return Boolean(connection.capabilities.tools);
  }

  supportsVision(connection: ResolvedProviderConnection): boolean {
    return Boolean(connection.capabilities.vision);
  }

  supportsJsonMode(connection: ResolvedProviderConnection): boolean {
    return Boolean(connection.capabilities.jsonMode);
  }
}

function truncate(text: string, max = 300): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}
