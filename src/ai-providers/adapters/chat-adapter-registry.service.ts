import { Injectable } from '@nestjs/common';
import type { ChatProviderAdapter } from './chat-adapter.interface.js';
import { OpenAiCompatibleChatAdapter } from './openai-compatible-chat.adapter.js';

/**
 * Maps `AiProvider.provider` (e.g. 'openai', 'groq') to the adapter that
 * speaks its wire format. Adding a real Anthropic/Gemini adapter later is:
 * write the class, add one line to `adapters` below — no other file changes.
 */
@Injectable()
export class ChatAdapterRegistry {
  private readonly adapters: ChatProviderAdapter[];

  constructor(openAiCompatible: OpenAiCompatibleChatAdapter) {
    this.adapters = [openAiCompatible];
  }

  getAdapter(provider: string): ChatProviderAdapter | null {
    return this.adapters.find((adapter) => adapter.supportedProviders.includes(provider)) ?? null;
  }
}
