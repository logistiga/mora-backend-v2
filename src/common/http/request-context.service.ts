import { Injectable } from '@nestjs/common';
import { AsyncLocalStorage } from 'node:async_hooks';

export interface RequestContextValue {
  requestId: string;
  method?: string;
  path?: string;
  userId?: string;
  role?: string;
  scope?: string;
  space?: string;
  conversationId?: string;
  voiceSessionId?: string;
}

@Injectable()
export class RequestContextService {
  private readonly storage = new AsyncLocalStorage<RequestContextValue>();

  run<T>(value: RequestContextValue, callback: () => T): T {
    return this.storage.run(value, callback);
  }

  get(): RequestContextValue | undefined {
    return this.storage.getStore();
  }

  set(patch: Partial<RequestContextValue>): void {
    const current = this.storage.getStore();
    if (!current) return;
    Object.assign(current, patch);
  }

  getRequestId(): string | undefined {
    return this.storage.getStore()?.requestId;
  }
}
