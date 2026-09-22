import { ClassSerializerInterceptor, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR, APP_PIPE, Reflector } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { ValidationPipe } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { AgentsModule } from './agents/agents.module.js';
import { AuditModule } from './audit/audit.module.js';
import { AuthModule } from './auth/auth.module.js';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter.js';
import { ConfigModule } from './config/config.module.js';
import type { AppConfig } from './config/configuration.js';
import { ContextModule } from './context/context.module.js';
import { ConversationsModule } from './conversations/conversations.module.js';
import { DatabaseModule } from './database/database.module.js';
import { EmbeddingModule } from './embedding/embedding.module.js';
import { HealthModule } from './health/health.module.js';
import { LlmModule } from './llm/llm.module.js';
import { MemoryModule } from './memory/memory.module.js';
import { MemoryQueueModule } from './memory/queue/memory-queue.module.js';
import { MessagesModule } from './messages/messages.module.js';
import { OrchestratorModule } from './orchestrator/orchestrator.module.js';
import { QueueModule } from './queue/queue.module.js';
import { RouterModule } from './router/router.module.js';
import { UsersModule } from './users/users.module.js';

@Module({
  imports: [
    ConfigModule,
    LoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const env = configService.get<AppConfig['env']>('app.env');
        return {
          pinoHttp: {
            level: env === 'production' ? 'info' : 'debug',
            transport:
              env !== 'production'
                ? { target: 'pino-pretty', options: { singleLine: true } }
                : undefined,
            autoLogging: env !== 'test',
            redact: ['req.headers.authorization'],
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
    LlmModule,
    EmbeddingModule,
    RouterModule,
    ContextModule,
    AgentsModule,
    AuditModule,
    ConversationsModule,
    MemoryModule,
    MemoryQueueModule,
    OrchestratorModule,
    MessagesModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    // Without this, @Exclude()/@Expose() on entities like UserEntity are inert
    // and fields such as passwordHash would be serialized as-is in responses.
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
