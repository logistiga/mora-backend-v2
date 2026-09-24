import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import type { LlmMessage } from '../llm/llm-provider.interface.js';
import { MessageRole, type Conversation, type Message, type Prisma } from '../generated/prisma/client.js';

const HISTORY_LIMIT = 20;

@Injectable()
export class ConversationsService {
  constructor(private readonly prisma: PrismaService) {}

  async createConversation(userId: string, title?: string): Promise<Conversation> {
    return this.prisma.conversation.create({ data: { userId, title } });
  }

  /** Fetches a conversation, creating one if `conversationId` is omitted. Throws if the
   *  conversation exists but belongs to someone else — conversations never cross users. */
  async getOrCreateConversation(userId: string, conversationId?: string): Promise<Conversation> {
    if (!conversationId) {
      return this.createConversation(userId);
    }

    const conversation = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
    });
    if (!conversation) {
      throw new NotFoundException('Conversation not found');
    }
    if (conversation.userId !== userId) {
      throw new ForbiddenException('This conversation does not belong to you');
    }
    return conversation;
  }

  async getConversationForUser(userId: string, conversationId: string): Promise<Conversation> {
    return this.getOrCreateConversation(userId, conversationId);
  }

  async listConversations(userId: string): Promise<Conversation[]> {
    return this.prisma.conversation.findMany({
      where: { userId },
      orderBy: { updatedAt: 'desc' },
    });
  }

  async getConversationWithMessages(
    userId: string,
    conversationId: string,
  ): Promise<Conversation & { messages: Message[] }> {
    await this.getOrCreateConversation(userId, conversationId);
    const conversation = await this.prisma.conversation.findUniqueOrThrow({
      where: { id: conversationId },
      include: { messages: { orderBy: { createdAt: 'asc' } } },
    });
    return conversation;
  }

  async addMessage(params: {
    conversationId: string;
    role: MessageRole;
    content: string;
    scope: string;
    space: string;
    metadata?: Record<string, unknown>;
  }): Promise<Message> {
    const message = await this.prisma.message.create({
      data: {
        conversationId: params.conversationId,
        role: params.role,
        content: params.content,
        scope: params.scope,
        space: params.space,
        metadata: (params.metadata ?? {}) as Prisma.InputJsonValue,
      },
    });
    await this.prisma.conversation.update({
      where: { id: params.conversationId },
      data: { updatedAt: new Date() },
    });
    return message;
  }

  async markMessageInterrupted(messageId: string, metadata: Record<string, unknown> = {}): Promise<Message> {
    const current = await this.prisma.message.findUniqueOrThrow({ where: { id: messageId } });
    const currentMeta =
      current.metadata && typeof current.metadata === 'object' && !Array.isArray(current.metadata)
        ? (current.metadata as Record<string, unknown>)
        : {};

    return this.prisma.message.update({
      where: { id: messageId },
      data: {
        metadata: {
          ...currentMeta,
          ...metadata,
          interrupted: true,
        } as Prisma.InputJsonValue,
      },
    });
  }

  /**
   * Returns prior turns of a conversation as LLM-ready messages, filtered to
   * `scope` (plus 'direct', which is scope-neutral small talk). This is the
   * enforcement point for "Personal never sees Professional and vice versa":
   * an agent is only ever handed history through this method, and it simply
   * never returns another scope's rows.
   */
  async getScopedHistory(
    conversationId: string,
    scope: string,
    limit = HISTORY_LIMIT,
  ): Promise<LlmMessage[]> {
    const messages = await this.prisma.message.findMany({
      where: {
        conversationId,
        scope: { in: [scope, 'direct'] },
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });

    return messages
      .reverse()
      .filter((message) => {
        if (message.role === MessageRole.SYSTEM) return false;
        const metadata =
          message.metadata && typeof message.metadata === 'object' && !Array.isArray(message.metadata)
            ? (message.metadata as Record<string, unknown>)
            : null;
        if (message.role === MessageRole.ASSISTANT && metadata?.interrupted === true) return false;
        return true;
      })
      .map((message) => ({
        role: message.role === MessageRole.ASSISTANT ? 'assistant' : 'user',
        content: message.content,
      }));
  }
}
