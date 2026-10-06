import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import * as express from 'express';
import { AppModule } from './app.module';
import { loadConfig } from './config/config';
import { LocalStorageProvider } from './modules/uploads/storage';

export async function createApp(): Promise<NestExpressApplication> {
  const cfg = loadConfig(); // fail fast on bad configuration
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { rawBody: true, logger: cfg.NODE_ENV === 'test' ? ['error'] : ['log', 'warn', 'error'] });
  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
  app.useBodyParser('json', { limit: '256kb' }); // keeps req.rawBody for webhook signature checks
  const origins = cfg.CORS_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean);
  app.enableCors({ origin: origins.length ? origins : false, credentials: false, exposedHeaders: ['x-request-id'] });
  app.enableShutdownHooks();

  // Public images only. Private (verification) documents live in a different directory and are never served statically.
  const storage = new LocalStorageProvider(cfg.STORAGE_DIR);
  app.use('/uploads', express.static(storage.publicDir(), { index: false, dotfiles: 'deny', maxAge: '7d', setHeaders: (r) => r.setHeader('X-Content-Type-Options', 'nosniff') }));

  if (cfg.NODE_ENV !== 'production') {
    const doc = SwaggerModule.createDocument(app, new DocumentBuilder().setTitle('Tablya API').setVersion('0.1').addBearerAuth().build());
    SwaggerModule.setup('docs', app, doc);
  }
  return app;
}
