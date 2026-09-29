import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { RUNTIME_CONFIG } from './shared/config/config.module';
import type { runtimeConfig } from './shared/config/runtime-config';
import { JsonLogger } from './shared/logging/json-logger';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    rawBody: true,
    logger: new JsonLogger()
  });
  app.enableShutdownHooks();
  const config = app.get<runtimeConfig>(RUNTIME_CONFIG);
  await app.listen(config.port, '0.0.0.0');
}

void bootstrap();
