import { Controller, Get } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiTags } from '@nestjs/swagger';
import {
  HealthCheck,
  HealthCheckService,
  HealthIndicatorService,
} from '@nestjs/terminus';
import { PrismaService } from '../database/prisma.service.js';
import type { AppConfig } from '../config/configuration.js';
import { RedisHealthIndicator } from './indicators/redis.health.js';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly healthIndicatorService: HealthIndicatorService,
    private readonly prisma: PrismaService,
    private readonly redisIndicator: RedisHealthIndicator,
    private readonly configService: ConfigService,
  ) {}

  @Get()
  @HealthCheck()
  async check() {
    const result = await this.health.check([
      async () => {
        const indicator = this.healthIndicatorService.check('postgres');
        try {
          await this.prisma.isHealthy();
          return indicator.up();
        } catch (error) {
          return indicator.down({ message: (error as Error).message });
        }
      },
      () => this.redisIndicator.isHealthy('redis'),
    ]);

    const app = this.configService.get<AppConfig>('app')!;
    return {
      ...result,
      environment: app.env,
      version: {
        build: app.buildVersion ?? null,
        gitCommit: app.gitCommit ?? null,
      },
    };
  }
}
