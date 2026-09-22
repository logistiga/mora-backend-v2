import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
  LlmCompletionRequest,
  LlmCompletionResult,
  LlmProviderInterface,
} from '../llm-provider.interface.js';

/**
 * Works against any OpenAI-compatible /chat/completions endpoint (OpenAI
 * itself, Azure OpenAI-compatible gateways, local servers like vLLM/Ollama
 * with an OpenAI shim, ...). Configured purely via env — no hardcoded key.
 */
@Injectable()
export class OpenAiCompatibleProvider implements LlmProviderInterface {
  readonly name = 'openai-compatible';
  private readonly logger = new Logger(OpenAiCompatibleProvider.name);

  private readonly apiKey?: string;
  private readonly baseUrl: string;
  private readonly model: string;

  constructor(configService: ConfigService) {
    this.apiKey = configService.get<string>('app.llm.openai.apiKey') || undefined;
    this.baseUrl =
      configService.get<string>('app.llm.openai.baseUrl') || 'https://api.openai.com/v1';
    this.model = configService.get<string>('app.llm.openai.model') || 'gpt-4o-mini';
  }

  isConfigured(): boolean {
    return Boolean(this.apiKey);
  }

  async complete(request: LlmCompletionRequest): Promise<LlmCompletionResult> {
    if (!this.isConfigured()) {
      throw new Error('OpenAiCompatibleProvider is not configured (missing OPENAI_API_KEY)');
    }

    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        messages: request.messages,
        temperature: request.temperature ?? 0.7,
        max_tokens: request.maxTokens ?? 512,
      }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      this.logger.error(`LLM request failed: ${response.status} ${body}`);
      throw new Error(`LLM provider request failed with status ${response.status}`);
    }

    const data = (await response.json()) as {
      choices?: { message?: { content?: string } }[];
      model?: string;
    };
    const content = data.choices?.[0]?.message?.content ?? '';

    return { content, provider: this.name, model: data.model ?? this.model };
  }
}
