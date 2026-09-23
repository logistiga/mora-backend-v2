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

    const body: Record<string, unknown> = {
      model: connection.model,
      messages: request.messages.map((m) =>
        m.role === 'tool'
          ? { role: 'tool', tool_call_id: m.toolCallId, content: m.content }
          : { role: m.role, content: m.content },
      ),
      temperature: request.temperature ?? 0.7,
      max_tokens: request.maxTokens ?? connection.settings.maxTokens ?? 512,
    };

    // Tool/function calling (Phase D, AGENTS §19): translate our
    // provider-neutral LlmToolDefinition[] into OpenAI's function-calling
    // wire format. Only sent when the caller actually offered tools — never
    // forced on a provider/model that wasn't asked for it.
    if (request.tools && request.tools.length > 0) {
      body.tools = request.tools.map((tool) => ({
        type: 'function',
        function: { name: tool.name, description: tool.description, parameters: tool.parameters },
      }));
      body.tool_choice = 'auto';
    }

    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: connection.settings.timeoutMs
        ? AbortSignal.timeout(connection.settings.timeoutMs)
        : undefined,
    });

    if (!response.ok) {
      const responseBody = await response.text().catch(() => '');
      this.logger.warn(`Chat provider request failed: ${response.status}`);
      throw new Error(`Chat provider request failed with status ${response.status}: ${truncate(responseBody)}`);
    }

    const data = (await response.json()) as {
      choices?: {
        message?: {
          content?: string | null;
          tool_calls?: { id: string; function: { name: string; arguments: string } }[];
        };
      }[];
      model?: string;
      usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
    };
    const message = data.choices?.[0]?.message;
    const content = message?.content ?? '';
    const toolCalls = message?.tool_calls?.map((tc) => ({
      name: tc.function.name,
      arguments: parseToolArguments(tc.function.arguments),
      providerCallId: tc.id,
    }));

    return {
      content,
      model: data.model ?? connection.model,
      promptTokens: data.usage?.prompt_tokens,
      completionTokens: data.usage?.completion_tokens,
      totalTokens: data.usage?.total_tokens,
      toolCalls: toolCalls && toolCalls.length > 0 ? toolCalls : undefined,
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

/** A model hallucinating malformed JSON arguments must never crash the call — treated as empty args. */
function parseToolArguments(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}
