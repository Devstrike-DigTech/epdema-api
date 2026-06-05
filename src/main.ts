import 'reflect-metadata';
// Sentry must initialise BEFORE NestFactory.create so exceptions thrown
// during DI / module construction are still captured. The function no-ops
// when SENTRY_DSN is empty (dev default).
import { flushSentry, initSentry } from './infra/sentry/sentry.bootstrap';
const sentryEnabled = initSentry();

import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { ValidationPipe, Logger } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { toNodeHandler } from 'better-auth/node';

import { AppModule } from './app.module';
import { auth } from './auth/better-auth.config';
import { GlobalExceptionFilter } from './common/filters/global-exception.filter';
import { RedisIoAdapter } from './realtime/redis-io.adapter';
import { LocalStorageAdapter } from './infra/storage/local-storage.adapter';

async function bootstrap(): Promise<void> {
  const logger = new Logger('Bootstrap');
  if (sentryEnabled) {
    logger.log(`🛰  Sentry enabled (${process.env.NODE_ENV ?? 'development'})`);
  }

  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
    // Needed so the Paystack webhook controller can verify the HMAC over the
    // exact bytes Paystack sent (any JSON re-serialization breaks the hash).
    rawBody: true,
  });

  // ── Security headers (CSP intentionally lax in dev; tightened by Cloudflare in prod)
  app.use(
    helmet({
      contentSecurityPolicy: process.env.NODE_ENV === 'production' ? undefined : false,
      crossOriginEmbedderPolicy: false,
    }),
  );

  // ── CORS
  const webOrigin = process.env.WEB_ORIGIN ?? 'http://localhost:3000';
  const allowedOrigins = [
    webOrigin,
    /\.vercel\.app$/, // Vercel previews
  ];
  app.enableCors({
    origin: allowedOrigins,
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'Idempotency-Key',
      'X-Requested-With',
      // The web api-client stamps every request with x-request-id for tracing.
      // It's a custom header, so it triggers a CORS preflight that fails unless
      // listed here — omitting it blocks /api/users/me, /api/events, etc.
      'X-Request-Id',
    ],
    exposedHeaders: ['Set-Cookie'],
  });

  // ── Mount Better Auth on the underlying Express adapter BEFORE NestJS's body parser
  // Better Auth wants the raw request; mounting it first ensures we don't double-parse.
  //
  // We use a RegExp route rather than a path string because the wildcard syntax
  // differs between Express 4 (`/api/auth/*`) and Express 5 (`/api/auth/*splat`),
  // and @nestjs/platform-express version bumps have flipped between them.
  // The regex is unambiguous on both.
  const expressApp = app.getHttpAdapter().getInstance();
  expressApp.all(/^\/api\/auth\/.+/, toNodeHandler(auth));

  // ── Global pipes / filters
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );
  app.useGlobalFilters(new GlobalExceptionFilter());

  // ── API prefix. /health stays at the root so uptime checks don't carry /api.
  // Better Auth routes don't need exclusion here — they're handled by the
  // expressApp.all() mount above, which runs before NestJS routing.
  app.setGlobalPrefix('api', { exclude: ['/health'] });

  // ── Local-storage static serving. Only mounted when STORAGE_DRIVER=local
  // (the default); in prod we expect STORAGE_DRIVER=s3 and a CDN to serve
  // the bucket directly, so the api never proxies bytes.
  const storageDriver = (process.env.STORAGE_DRIVER ?? 'local').toLowerCase();
  if (storageDriver === 'local') {
    const local = app.get(LocalStorageAdapter);
    const { fsRoot, urlPrefix } = local.getServingRoot();
    // Helmet sets `Cross-Origin-Resource-Policy: same-origin` globally — that
    // would block <img src="http://localhost:3001/uploads/…"> rendering from
    // the web app at :3000. Uploads are public by design, so relax CORP just
    // for this path. Everything else keeps the stricter default.
    expressApp.use(urlPrefix, (_req, res, next) => {
      res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
      next();
    });
    expressApp.use(
      urlPrefix,
      (await import('express')).default.static(fsRoot, {
        maxAge: '1y',
        immutable: true,
        index: false,
      }),
    );
    logger.log(`🖼  Local uploads served from ${urlPrefix} → ${fsRoot}`);
  }

  // ── Socket.IO adapter with Redis pub/sub for horizontal scale.
  // Single instance in dev still works (the adapter no-ops to local).
  const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6379';
  const ioAdapter = new RedisIoAdapter(app, redisUrl);
  await ioAdapter.connectToRedis();
  app.useWebSocketAdapter(ioAdapter);

  // ── Swagger / OpenAPI
  if (process.env.NODE_ENV !== 'production') {
    const config = new DocumentBuilder()
      .setTitle('EPDEMA API')
      .setDescription('Event Planning Decision Making Assistant')
      .setVersion('0.1.0')
      .addBearerAuth()
      .addCookieAuth('better-auth.session_token')
      .build();
    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('api/docs', app, document);
  }

  const port = Number(process.env.PORT ?? 3001);
  await app.listen(port, '0.0.0.0');

  logger.log(`🚀 EPDEMA API listening on http://localhost:${port}`);
  logger.log(`📚 Swagger docs at http://localhost:${port}/api/docs`);
  logger.log(`🔐 Better Auth mounted at http://localhost:${port}/api/auth/*`);
  logger.log(`📡 Realtime gateway at ws://localhost:${port}/realtime`);

  // Graceful shutdown — flush queued Sentry events before the process dies.
  // Railway sends SIGTERM with a 30s grace period; 2s is well within budget.
  const shutdown = async (signal: string) => {
    logger.log(`Received ${signal}, draining…`);
    await flushSentry(2000);
    await app.close();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

bootstrap().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Fatal bootstrap error', err);
  process.exit(1);
});
