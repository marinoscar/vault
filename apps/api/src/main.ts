// IMPORTANT: Load instrumentation before anything else
import './instrumentation';

import { NestFactory } from '@nestjs/core';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { Logger } from '@nestjs/common';
import fastifyCookie from '@fastify/cookie';
import multipart from '@fastify/multipart';
import { buildCorsOptions, registerPlatformDocs } from '@marinoscar/platform-api/host';
import { AppModule } from './app.module';
import { APP_OPENAPI } from './openapi/document';

async function bootstrap() {
  const logger = new Logger('Bootstrap');

  // Safety check: prevent test auth module in production
  if (process.env.NODE_ENV === 'production' && process.env.TEST_AUTH_ENABLED === 'true') {
    throw new Error('TEST_AUTH_ENABLED must not be true in production');
  }

  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({
      logger: true,
      // Fastify defaults to a 1 MiB body limit, and the @fastify/multipart
      // limits below do NOT apply to application/json. POST
      // /api/secrets/cards/extract sends card photographs as base64 data URLs
      // in a JSON body, which would be rejected with
      // FST_ERR_CTP_BODY_TOO_LARGE before the controller ever ran.
      // 16 MiB comfortably fits two full-photo images (~4.5 MB binary each)
      // after base64 inflation; the per-image cap is enforced in the extract
      // schema.
      bodyLimit: 16 * 1024 * 1024,
    }),
  );

  // Register cookie plugin
  await app.register(fastifyCookie, {
    secret: process.env.COOKIE_SECRET || process.env.JWT_SECRET,
  });

  // Register multipart plugin for file uploads
  await app.register(multipart, {
    limits: {
      fileSize: 10 * 1024 * 1024 * 1024, // 10GB for large media files
      files: 1,
    },
  });

  // Global prefix for all routes
  app.setGlobalPrefix('api');

  // Enable CORS (same-origin by default: CORS_ORIGIN unset sends no CORS
  // headers; a comma-separated list gives exactly those origins).
  app.enableCors(
    buildCorsOptions(process.env.CORS_ORIGIN, {
      // Response headers a cross-origin client may read. The backup downloads
      // (POST /api/secrets/export, POST /api/admin/backups/export) report their
      // file name and counts in these.
      exposedHeaders: [
        'Content-Disposition',
        'X-Vault-Export-Secrets',
        'X-Vault-Export-Attachments',
        'X-Vault-Export-Media-Files',
        'X-Vault-Export-Users',
      ],
    }),
  );

  // OpenAPI: the document and the two routes that serve it (`/api/docs`, the
  // Scalar API reference, and `/api/openapi.json`), built by the platform host
  // slice from `APP_OPENAPI`. After `setGlobalPrefix('api')` because the
  // introspection reads the prefix off the application. Degrades to a 503 on
  // both paths, never the boot, if generation throws.
  const docsReady = registerPlatformDocs(app, APP_OPENAPI, logger);

  const port = process.env.PORT || 3000;
  await app.listen(port, '0.0.0.0');

  logger.log(`Application running on port ${port}`);
  logger.log(
    docsReady
      ? 'API reference available at /api/docs'
      : 'API reference DEGRADED: /api/docs and /api/openapi.json return 503 (see error above)',
  );
}

bootstrap();
