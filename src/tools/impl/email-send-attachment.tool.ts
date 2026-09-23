import { Inject, Injectable } from '@nestjs/common';
import { IsString, IsUUID, MaxLength, MinLength } from 'class-validator';
import { PrismaService } from '../../database/prisma.service.js';
import { DocumentService } from '../../documents/document.service.js';
import type { DocumentStorageInterface } from '../../documents/storage/document-storage.interface.js';
import { DOCUMENT_STORAGE } from '../../documents/storage/document-storage.token.js';
import { EmailAccountService } from '../../email/email-account.service.js';
import type { EmailProviderInterface } from '../../email/providers/email-provider.interface.js';
import { EMAIL_PROVIDER } from '../../email/providers/email-provider.token.js';
import { validateWithDto } from '../tool-validation.util.js';
import type { MoraTool, ToolContext, ToolResult, ToolValidationResult } from '../tool.types.js';

class EmailSendAttachmentInput {
  @IsUUID()
  threadId: string;

  @IsUUID()
  documentId: string;

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  subject: string;

  @IsString()
  @MinLength(1)
  @MaxLength(10000)
  text: string;
}

/** N2: always requires confirmation (AGENTS §37). */
@Injectable()
export class EmailSendAttachmentTool implements MoraTool<EmailSendAttachmentInput> {
  readonly name = 'email_send_attachment';
  readonly description = "Envoie un email avec un document (déjà connu de Mora) en pièce jointe (nécessite toujours une confirmation).";
  readonly version = '1.0.0';
  readonly securityLevel = 'N2' as const;
  readonly allowedScopes = ['personal', 'professional'] as const;
  readonly requiresConfirmation = true;
  readonly jsonSchema = {
    type: 'object' as const,
    properties: {
      threadId: { type: 'string', format: 'uuid' },
      documentId: { type: 'string', format: 'uuid' },
      subject: { type: 'string' },
      text: { type: 'string' },
    },
    required: ['threadId', 'documentId', 'subject', 'text'],
    additionalProperties: false as const,
  };

  constructor(
    private readonly prisma: PrismaService,
    private readonly documentService: DocumentService,
    @Inject(DOCUMENT_STORAGE) private readonly storage: DocumentStorageInterface,
    private readonly accountService: EmailAccountService,
    @Inject(EMAIL_PROVIDER) private readonly provider: EmailProviderInterface,
  ) {}

  validate(input: unknown): ToolValidationResult<EmailSendAttachmentInput> {
    return validateWithDto(EmailSendAttachmentInput, input);
  }

  async execute(context: ToolContext, input: EmailSendAttachmentInput): Promise<ToolResult> {
    const thread = await this.prisma.emailThread.findUnique({ where: { id: input.threadId } });
    if (!thread || thread.scope !== context.scope || thread.space !== context.space) {
      return { ok: false, errorCode: 'scope_mismatch' };
    }
    const document = await this.documentService.getById(context.userId, input.documentId);
    if (document.scope !== context.scope || document.space !== context.space) {
      return { ok: false, errorCode: 'scope_mismatch' };
    }
    if (!thread.contactId) return { ok: false, errorCode: 'no_contact' };

    const identity = await this.prisma.contactIdentity.findFirst({ where: { contactId: thread.contactId, type: 'email' } });
    if (!identity) return { ok: false, errorCode: 'no_email_identity' };

    const connection = await this.accountService.resolveConnection(thread.accountId);
    const buffer = await this.storage.read(document.storageKey);

    try {
      const result = await this.provider.send(connection, {
        to: [identity.valueNormalized],
        subject: input.subject,
        text: input.text,
        attachments: [{ filename: document.originalFilename, content: buffer, contentType: document.mimeType }],
      });
      return { ok: true, data: result };
    } catch (error) {
      return { ok: false, errorCode: 'send_failed', errorMessage: error instanceof Error ? error.message.slice(0, 200) : 'send failed' };
    }
  }
}
