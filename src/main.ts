import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Logger } from 'nestjs-pino';
import helmet from 'helmet';
import { AppModule } from './app.module.js';
import type { AppConfig } from './config/configuration.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
  });

  app.useLogger(app.get(Logger));
  app.use(helmet());

  const configService = app.get(ConfigService);
  const appConfig = configService.get<AppConfig>('app')!;

  app.enableCors({
    origin: parseCorsOrigins(appConfig.corsOrigin),
    credentials: true,
  });

  app.setGlobalPrefix(appConfig.apiPrefix);

  if (appConfig.swaggerEnabled) {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('Mora Backend v2')
      .setDescription('Phase A — core foundation API')
      .setVersion('0.1.0')
      .addBearerAuth()
      .build();
    const document = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup('docs', app, document);
  }

  await app.listen(appConfig.port);
}

/**
 * Entries containing `*` become anchored regexes (`*.lovable.app` matches any
 * subdomain), everything else stays an exact origin string.
 */
function parseCorsOrigins(configured: string): (string | RegExp)[] {
  return configured
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0)
    .map((origin) =>
      origin.includes('*')
        ? new RegExp(
            `^${origin.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^.]+')}$`,
          )
        : origin,
    );
}

bootstrap().catch((error) => {
  // eslint-disable-next-line no-console
  console.error('Fatal error during bootstrap', error);
  process.exit(1);
});
