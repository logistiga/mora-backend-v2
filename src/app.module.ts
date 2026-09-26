import { randomUUID } from 'node:crypto';
import { ClassSerializerInterceptor, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR, APP_PIPE, Reflector } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { ValidationPipe } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { AgentsModule } from './agents/agents.module.js';
import { AiProvidersModule } from './ai-providers/ai-providers.module.js';
import { AvatarModule } from './avatar/avatar.module.js';
import { AuditModule } from './audit/audit.module.js';
import { AuthModule } from './auth/auth.module.js';
import { BusinessConnectorsModule } from './business-connectors/business-connectors.module.js';
import { CalendarModule } from './calendar/calendar.module.js';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter.js';
import { RequestContextInterceptor } from './common/http/request-context.interceptor.js';
import { RequestContextModule } from './common/http/request-context.module.js';
import { ConfigModule } from './config/config.module.js';
import type { AppConfig } from './config/configuration.js';
import { BugReportsModule } from './bug-reports/bug-reports.module.js';
import { ContactsModule } from './contacts/contacts.module.js';
import { ContextModule } from './context/context.module.js';
import { ConversationsModule } from './conversations/conversations.module.js';
import { DatabaseModule } from './database/database.module.js';
import { DocumentsModule } from './documents/documents.module.js';
import { EmailModule } from './email/email.module.js';
import { EmbeddingModule } from './embedding/embedding.module.js';
import { HealthModule } from './health/health.module.js';
import { LlmModule } from './llm/llm.module.js';
import { MemoryModule } from './memory/memory.module.js';
import { MemoryQueueModule } from './memory/queue/memory-queue.module.js';
import { MessagesModule } from './messages/messages.module.js';
import { NotificationsModule } from './notifications/notifications.module.js';
import { OrchestratorModule } from './orchestrator/orchestrator.module.js';
import { PendingActionsModule } from './pending-actions/pending-actions.module.js';
import { QueueModule } from './queue/queue.module.js';
import { RemindersModule } from './reminders/reminders.module.js';
import { RouterModule } from './router/router.module.js';
import { TasksModule } from './tasks/tasks.module.js';
import { ToolsModule } from './tools/tools.module.js';
import { UsersModule } from './users/users.module.js';
import { VoiceModule } from './voice/voice.module.js';
import { VisionModule } from './vision/vision.module.js';
import { WhatsAppModule } from './whatsapp/whatsapp.module.js';

@Module({
  imports: [
    ConfigModule,
    RequestContextModule,
    LoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const env = configService.get<AppConfig['env']>('app.env');
        return {
          pinoHttp: {
            level: env === 'production' ? 'info' : 'debug',
            // pino-pretty is a dev dependency, absent from production images:
            // gate it on NODE_ENV, not on `app.env` (which is `staging` there).
            transport:
              env !== 'production' && process.env.NODE_ENV !== 'production'
                ? { target: 'pino-pretty', options: { singleLine: true } }
                : undefined,
            autoLogging: env !== 'test',
            genReqId: (req, res) => {
              const incoming = req.headers['x-request-id'];
              const requestId =
                typeof incoming === 'string' && incoming.trim()
                  ? incoming.trim()
                  : randomUUID();
              res.setHeader('X-Request-Id', requestId);
              return requestId;
            },
            customProps: (req) => ({
              requestId: req.id,
              userId: (req as { user?: { id?: string } }).user?.id,
            }),
            redact: [
              'req.headers.authorization',
              'req.headers.cookie',
              'res.headers["set-cookie"]',
              'req.body.password',
              'req.body.refreshToken',
              'req.body.apiKey',
              'req.body.credentials',
            ],
          },
        };
      },
    }),
    ThrottlerModule.forRootAsync({
      imports: [],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        throttlers: [
          {
            ttl: configService.get<number>('app.throttle.ttl')! * 1000,
            limit: configService.get<number>('app.throttle.limit')!,
          },
        ],
      }),
    }),
    DatabaseModule,
    QueueModule,
    HealthModule,
    AuthModule,
    UsersModule,
    AiProvidersModule,
    AvatarModule,
    LlmModule,
    EmbeddingModule,
    RouterModule,
    ContextModule,
    AgentsModule,
    AuditModule,
    BugReportsModule,
    ConversationsModule,
    MemoryModule,
    MemoryQueueModule,
    TasksModule,
    NotificationsModule,
    RemindersModule,
    DocumentsModule,
    ContactsModule,
    CalendarModule,
    WhatsAppModule,
    EmailModule,
    BusinessConnectorsModule,
    ToolsModule,
    PendingActionsModule,
    OrchestratorModule,
    MessagesModule,
    VoiceModule,
    VisionModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    // Without this, @Exclude()/@Expose() on entities like UserEntity are inert
    // and fields such as passwordHash would be serialized as-is in responses.
    {
      provide: APP_INTERCEPTOR,
      useClass: RequestContextInterceptor,
    },
    {
      provide: APP_INTERCEPTOR,
      useFactory: (reflector: Reflector) => new ClassSerializerInterceptor(reflector),
      inject: [Reflector],
    },
    {
      provide: APP_PIPE,
      useValue: new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        transformOptions: { enableImplicitConversion: true },
      }),
    },
  ],
})
export class AppModule {}
