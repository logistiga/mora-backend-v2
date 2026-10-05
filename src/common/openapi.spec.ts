import { Test } from '@nestjs/testing';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import type { INestApplication } from '@nestjs/common';
import { AiProviderSystemController } from '../ai-providers/ai-provider-system.controller.js';
import { AiProviderController } from '../ai-providers/ai-provider.controller.js';
import { ApiKeysController } from '../auth/api-keys/api-keys.controller.js';
import { AuthController } from '../auth/auth.controller.js';
import { AvatarController } from '../avatar/avatar.controller.js';
import { BugReportsController } from '../bug-reports/bug-reports.controller.js';
import { CalendarController } from '../calendar/calendar.controller.js';
import { ContactsController } from '../contacts/contacts.controller.js';
import { ConversationsController } from '../conversations/conversations.controller.js';
import { RouterDecisionsController } from '../conversations/router-decisions.controller.js';
import { DocumentsController } from '../documents/documents.controller.js';
import { EmailController } from '../email/email.controller.js';
import { GoogleController } from '../google/google.controller.js';
import { HealthController } from '../health/health.controller.js';
import { ConversationSummariesController } from '../memory/conversation-summaries.controller.js';
import { EntitiesController } from '../memory/entities.controller.js';
import { MemoryController } from '../memory/memory.controller.js';
import { ProfileFactsController } from '../memory/profile-facts.controller.js';
import { MessagesController } from '../messages/messages.controller.js';
import { NotificationsController } from '../notifications/notifications.controller.js';
import { PendingActionsController } from '../pending-actions/pending-actions.controller.js';
import { RemindersController } from '../reminders/reminders.controller.js';
import { SkillsController } from '../skills/skills.controller.js';
import { TasksController } from '../tasks/tasks.controller.js';
import { ToolsController } from '../tools/tools.controller.js';
import { UsersController } from '../users/users.controller.js';
import { VisionController } from '../vision/vision.controller.js';
import { VoiceController } from '../voice/voice.controller.js';
import { WhatsAppWebhookController } from '../whatsapp/whatsapp-webhook.controller.js';
import { WhatsAppController } from '../whatsapp/whatsapp.controller.js';

// Use the real controllers, without connecting services or calling handlers.
// This covers generated operation security, including mixed public controllers.
describe('OpenAPI authentication documentation', () => {
  let app: INestApplication;
  let document: ReturnType<typeof SwaggerModule.createDocument>;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [AiProviderSystemController, AiProviderController, ApiKeysController, AuthController, AvatarController, BugReportsController, CalendarController, ContactsController, ConversationsController, RouterDecisionsController, DocumentsController, EmailController, GoogleController, HealthController, ConversationSummariesController, EntitiesController, MemoryController, ProfileFactsController, MessagesController, NotificationsController, PendingActionsController, RemindersController, SkillsController, TasksController, ToolsController, UsersController, VisionController, VoiceController, WhatsAppWebhookController, WhatsAppController],
    }).useMocker(() => ({})).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    const config = new DocumentBuilder()
      .addBearerAuth()
      .addApiKey({ type: 'apiKey', in: 'header', name: 'X-Api-Key' }, 'api-key')
      .build();
    document = SwaggerModule.createDocument(app, config);
  });

  afterAll(async () => { await app?.close(); });

  it('defines the existing header API key and no global security requirement', () => {
    expect(document.components?.securitySchemes?.['api-key']).toEqual({
      type: 'apiKey', in: 'header', name: 'X-Api-Key',
    });
    expect(document.security ?? []).toEqual([]);
  });

  it('documents skills with independent JWT OR API key alternatives', () => {
    for (const [path, methods] of Object.entries(document.paths)) {
      if (path.startsWith('/api/v1/skills')) {
        for (const operation of Object.values(methods!)) {
          expect(operation.security).toEqual([{ bearer: [] }, { 'api-key': [] }]);
        }
      }
    }
    expect(document.paths['/api/v1/skills']?.get?.security)
      .toEqual([{ bearer: [] }, { 'api-key': [] }]);
  });

  it('keeps all three key-management endpoints JWT only', () => {
    expect(document.paths['/api/v1/api-keys']?.post?.security).toEqual([{ bearer: [] }]);
    expect(document.paths['/api/v1/api-keys']?.get?.security).toEqual([{ bearer: [] }]);
    expect(document.paths['/api/v1/api-keys/{id}']?.delete?.security).toEqual([{ bearer: [] }]);
  });

  it.each([
    ['/api/v1/health', 'get'],
    ['/api/v1/auth/register', 'post'],
    ['/api/v1/auth/login', 'post'],
    ['/api/v1/google/oauth/callback', 'get'],
    ['/api/v1/webhooks/whatsapp/{accountId}', 'post'],
    // Refresh/logout authenticate through the documented refreshToken body,
    // not the access JWT header or API key. Preserve that existing contract.
    ['/api/v1/auth/refresh', 'post'],
    ['/api/v1/auth/logout', 'post'],
  ] as const)('does not add access authentication to %s %s', (path, method) => {
    const operation = document.paths[path]?.[method];
    expect(operation).toBeDefined();
    expect(operation?.security ?? []).toEqual([]);
  });

  it('documents every other secured operation with the two alternatives', () => {
    let dualAuthOperations = 0;
    for (const [path, methods] of Object.entries(document.paths)) {
      for (const operation of Object.values(methods!)) {
        if (!operation.security?.length || path.startsWith('/api/v1/api-keys')) continue;
        expect(operation.security, path).toEqual([{ bearer: [] }, { 'api-key': [] }]);
        dualAuthOperations++;
      }
    }
    expect(dualAuthOperations).toBe(110);
  });
});
