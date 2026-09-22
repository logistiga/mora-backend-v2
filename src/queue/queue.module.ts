import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { QueueEvents } from 'bullmq';
import type { AppConfig } from '../config/configuration.js';
import { HealthcheckProcessor } from './processors/healthcheck.processor.js';
import { HEALTHCHECK_QUEUE, HEALTHCHECK_QUEUE_EVENTS } from './queue.constants.js';
import { QueueService } from './queue.service.js';

@Module({
  imports: [
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const redis = configService.get<AppConfig['redis']>('app.redis')!;
        return {
          connection: {
            host: redis.host,
            port: redis.port,
            password: redis.password,
          },
        };
      },
    }),
    BullModule.registerQueue({ name: HEALTHCHECK_QUEUE }),
  ],
  providers: [
    HealthcheckProcessor,
    QueueService,
    {
      provide: HEALTHCHECK_QUEUE_EVENTS,
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const redis = configService.get<AppConfig['redis']>('app.redis')!;
        return new QueueEvents(HEALTHCHECK_QUEUE, {
          connection: { host: redis.host, port: redis.port, password: redis.password },
        });
      },
    },
  ],
  exports: [QueueService, BullModule],
})
export class QueueModule {}
