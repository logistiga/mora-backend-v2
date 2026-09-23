import { Injectable } from '@nestjs/common';
import { IsUUID } from 'class-validator';
import { PrismaService } from '../../database/prisma.service.js';
import { DocumentService } from '../../documents/document.service.js';
import { DOCUMENT_STORAGE } from '../../documents/storage/document-storage.token.js';
import type { DocumentStorageInterface } from '../../documents/storage/document-storage.interface.js';
import { WhatsAppAccountService } from '../../whatsapp/whatsapp-account.service.js';
import type { WhatsAppProviderInterface } from '../../whatsapp/providers/whatsapp-provider.interface.js';
import { WHATSAPP_PROVIDER } from '../../whatsapp/providers/whatsapp-provider.token.js';
import { validateWithDto } from '../tool-validation.util.js';
import type { MoraTool, ToolContext, ToolResult, ToolValidationResult } from '../tool.types.js';
import { Inject } from '@nestjs/common';

class WhatsAppSendDocumentInput {
  @IsUUID()
  conversationId: string;

  @IsUUID()
  documentId: string;
}

/** N2: always requires confirmation (AGENTS §30/§31). */
@Injectable()
export class WhatsAppSendDocumentTool implements MoraTool<WhatsAppSendDocumentInput> {
  readonly name = 'whatsapp_send_document';
  readonly description = "Envoie un document (déjà connu de Mora) via WhatsApp (nécessite toujours une confirmation).";
  readonly version = '1.0.0';
  readonly securityLevel = 'N2' as const;
  readonly allowedScopes = ['personal', 'professional'] as const;
  readonly requiresConfirmation = true;
  readonly jsonSchema = {
    type: 'object' as const,
    properties: { conversationId: { type: 'string', format: 'uuid' }, documentId: { type: 'string', format: 'uuid' } },
    required: ['conversationId', 'documentId'],
    additionalProperties: false as const,
  };

  constructor(
    private readonly prisma: PrismaService,
    private readonly documentService: DocumentService,
    @Inject(DOCUMENT_STORAGE) private readonly storage: DocumentStorageInterface,
    private readonly accountService: WhatsAppAccountService,
    @Inject(WHATSAPP_PROVIDER) private readonly provider: WhatsAppProviderInterface,
  ) {}

  validate(input: unknown): ToolValidationResult<WhatsAppSendDocumentInput> {
    return validateWithDto(WhatsAppSendDocumentInput, input);
  }

  async execute(context: ToolContext, input: WhatsAppSendDocumentInput): Promise<ToolResult> {
    const conversation = await this.prisma.whatsAppConversation.findUnique({ where: { id: input.conversationId } });
    if (!conversation || conversation.scope !== context.scope || conversation.space !== context.space) {
      return { ok: false, errorCode: 'scope_mismatch' };
    }
    const document = await this.documentService.getById(context.userId, input.documentId);
    if (document.scope !== context.scope || document.space !== context.space) {
      return { ok: false, errorCode: 'scope_mismatch' };
    }
    if (!conversation.contactId) return { ok: false, errorCode: 'no_contact' };

    const identity = await this.prisma.contactIdentity.findFirst({ where: { contactId: conversation.contactId, type: 'whatsapp' } });
    if (!identity) return { ok: false, errorCode: 'no_whatsapp_identity' };

    const connection = await this.accountService.resolveConnection(conversation.accountId);
    const buffer = await this.storage.read(document.storageKey);

    try {
      const result = await this.provider.sendDocument(connection, identity.valueNormalized, {
        buffer,
        filename: document.originalFilename,
        mimeType: document.mimeType,
      });
      return { ok: true, data: result };
    } catch (error) {
      return { ok: false, errorCode: 'send_failed', errorMessage: error instanceof Error ? error.message.slice(0, 200) : 'send failed' };
    }
  }
}
