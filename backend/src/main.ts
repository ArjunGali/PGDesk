import { ValidationPipe, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import helmet from 'helmet';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { AppModule } from './app.module';
import { PrismaService } from './common/prisma/prisma.service';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: false });
  const config = app.get(ConfigService);
  const logger = new Logger('Bootstrap');

  app.setGlobalPrefix('api');
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));

  // The Android build talks to the API from capacitor:// and http://localhost.
  const origins = config
    .get<string>('CORS_ORIGINS', 'http://localhost:5173')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  app.enableCors({ origin: origins, credentials: true });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: false,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
    }),
  );

  const storageRoot = resolve(config.get<string>('STORAGE_ROOT', './storage'));
  await mkdir(storageRoot, { recursive: true });

  app.get(PrismaService).enableShutdownHooks(app);
  app.enableShutdownHooks();

  const port = Number(config.get<string>('PORT', '3000'));
  await app.listen(port, '0.0.0.0');
  logger.log(`PG Management API listening on http://0.0.0.0:${port}/api`);
  logger.log(`Document storage: ${storageRoot}`);
}

void bootstrap();
