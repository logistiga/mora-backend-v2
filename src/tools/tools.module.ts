import { Module, type OnModuleInit } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { PassportModule } from '@nestjs/passport';
import { AuditModule } from '../audit/audit.module.js';
import { BusinessConnectorsModule } from '../business-connectors/business-connectors.module.js';
import { CalendarModule } from '../calendar/calendar.module.js';
import { ContactsModule } from '../contacts/contacts.module.js';
import { DocumentsModule } from '../documents/documents.module.js';
import { EmailModule } from '../email/email.module.js';
import { LlmModule } from '../llm/llm.module.js';
import { MemoryModule } from '../memory/memory.module.js';
import { RemindersModule } from '../reminders/reminders.module.js';
import { TasksModule } from '../tasks/tasks.module.js';
import { WhatsAppModule } from '../whatsapp/whatsapp.module.js';
import { CalendarCancelEventTool } from './impl/calendar-cancel-event.tool.js';
import { CalendarCreateEventTool } from './impl/calendar-create-event.tool.js';
import { CalendarFindFreeSlotsTool } from './impl/calendar-find-free-slots.tool.js';
import { CalendarGetEventTool } from './impl/calendar-get-event.tool.js';
import { CalendarListEventsTool } from './impl/calendar-list-events.tool.js';
import { CalendarUpdateEventTool } from './impl/calendar-update-event.tool.js';
import { CancelReminderTool } from './impl/cancel-reminder.tool.js';
import { CompleteTaskTool } from './impl/complete-task.tool.js';
import { CreateContactTool } from './impl/create-contact.tool.js';
import { CreateReminderTool } from './impl/create-reminder.tool.js';
import { CreateTaskTool } from './impl/create-task.tool.js';
import { DraftActionTool } from './impl/draft-action.tool.js';
import { EmailDraftReplyTool } from './impl/email-draft-reply.tool.js';
import { EmailListThreadsTool } from './impl/email-list-threads.tool.js';
import { EmailReadThreadTool } from './impl/email-read-thread.tool.js';
import { EmailSearchTool } from './impl/email-search.tool.js';
import { EmailSendAttachmentTool } from './impl/email-send-attachment.tool.js';
import { EmailSendTool } from './impl/email-send.tool.js';
import { GetContactTool } from './impl/get-contact.tool.js';
import { GetDocumentTool } from './impl/get-document.tool.js';
import { GetProfileFactsTool } from './impl/get-profile-facts.tool.js';
import { GetTaskTool } from './impl/get-task.tool.js';
import { ListContactsTool } from './impl/list-contacts.tool.js';
import { ListPendingActionsTool } from './impl/list-pending-actions.tool.js';
import { ListRemindersTool } from './impl/list-reminders.tool.js';
import { ListTasksTool } from './impl/list-tasks.tool.js';
import { LogistiGAGetEntityTool } from './impl/logistiga-get-entity.tool.js';
import { LogistiGAGetSummaryTool } from './impl/logistiga-get-summary.tool.js';
import { LogistiGASearchTool } from './impl/logistiga-search.tool.js';
import { PistonGetEntityTool } from './impl/piston-get-entity.tool.js';
import { PistonGetSummaryTool } from './impl/piston-get-summary.tool.js';
import { PistonSearchTool } from './impl/piston-search.tool.js';
import { QueryDocumentTableTool } from './impl/query-document-table.tool.js';
import { SearchContactsTool } from './impl/search-contacts.tool.js';
import { SearchDocumentContentTool } from './impl/search-document-content.tool.js';
import { SearchDocumentsTool } from './impl/search-documents.tool.js';
import { SearchMemoriesTool } from './impl/search-memories.tool.js';
import { UpdateContactTool } from './impl/update-contact.tool.js';
import { UpdateTaskTool } from './impl/update-task.tool.js';
import { WhatsAppDraftReplyTool } from './impl/whatsapp-draft-reply.tool.js';
import { WhatsAppGetContactTool } from './impl/whatsapp-get-contact.tool.js';
import { WhatsAppListConversationsTool } from './impl/whatsapp-list-conversations.tool.js';
import { WhatsAppReadMessagesTool } from './impl/whatsapp-read-messages.tool.js';
import { WhatsAppSearchMessagesTool } from './impl/whatsapp-search-messages.tool.js';
import { WhatsAppSendDocumentTool } from './impl/whatsapp-send-document.tool.js';
import { WhatsAppSendMessageTool } from './impl/whatsapp-send-message.tool.js';
import { PermissionService } from './permission.service.js';
import { ToolExecutorService } from './tool-executor.service.js';
import { ToolRegistryService } from './tool-registry.service.js';
import { ToolsController } from './tools.controller.js';
import type { MoraTool } from './tool.types.js';

// Phase D tools
const PHASE_D_TOOLS = [
  CreateTaskTool,
  ListTasksTool,
  GetTaskTool,
  UpdateTaskTool,
  CompleteTaskTool,
  CreateReminderTool,
  ListRemindersTool,
  CancelReminderTool,
  SearchMemoriesTool,
  GetProfileFactsTool,
  ListPendingActionsTool,
  DraftActionTool,
] as const;

// Phase E tools — Document Intelligence, Contacts, WhatsApp, Email, Calendar, Business connectors
const PHASE_E_TOOLS = [
  SearchDocumentsTool,
  GetDocumentTool,
  SearchDocumentContentTool,
  QueryDocumentTableTool,
  ListContactsTool,
  GetContactTool,
  SearchContactsTool,
  CreateContactTool,
  UpdateContactTool,
  WhatsAppListConversationsTool,
  WhatsAppReadMessagesTool,
  WhatsAppSearchMessagesTool,
  WhatsAppGetContactTool,
  WhatsAppDraftReplyTool,
  WhatsAppSendMessageTool,
  WhatsAppSendDocumentTool,
  EmailListThreadsTool,
  EmailReadThreadTool,
  EmailSearchTool,
  EmailDraftReplyTool,
  EmailSendTool,
  EmailSendAttachmentTool,
  CalendarListEventsTool,
  CalendarGetEventTool,
  CalendarFindFreeSlotsTool,
  CalendarCreateEventTool,
  CalendarUpdateEventTool,
  CalendarCancelEventTool,
  LogistiGASearchTool,
  LogistiGAGetEntityTool,
  LogistiGAGetSummaryTool,
  PistonSearchTool,
  PistonGetEntityTool,
  PistonGetSummaryTool,
] as const;

const ALL_TOOL_PROVIDERS = [...PHASE_D_TOOLS, ...PHASE_E_TOOLS];

/**
 * Owns the Tool Registry and every concrete MoraTool implementation
 * (Phase D + Phase E). Every tool registers itself here at module init —
 * nothing outside this module constructs a tool instance directly, so
 * ToolRegistryService.list()/get() is always the single source of truth for
 * "what tools exist" (AGENTS Phase D §4, reaffirmed Phase E §0: "Toutes les
 * connexions doivent passer par ... ToolRegistry").
 *
 * Tool instances are gathered via `ModuleRef.get()` in `onModuleInit`
 * (rather than a 46-parameter constructor) — see the loop below.
 */
@Module({
  imports: [
    TasksModule,
    RemindersModule,
    MemoryModule,
    AuditModule,
    DocumentsModule,
    ContactsModule,
    CalendarModule,
    WhatsAppModule,
    EmailModule,
    BusinessConnectorsModule,
    LlmModule,
    PassportModule.register({ defaultStrategy: 'jwt-access' }),
  ],
  controllers: [ToolsController],
  providers: [ToolRegistryService, PermissionService, ToolExecutorService, ...ALL_TOOL_PROVIDERS],
  exports: [ToolRegistryService, PermissionService, ToolExecutorService],
})
export class ToolsModule implements OnModuleInit {
  constructor(
    private readonly registry: ToolRegistryService,
    private readonly moduleRef: ModuleRef,
  ) {}

  onModuleInit(): void {
    for (const ToolClass of ALL_TOOL_PROVIDERS) {
      const instance = this.moduleRef.get(ToolClass, { strict: false }) as MoraTool;
      this.registry.register(instance);
    }
  }
}
