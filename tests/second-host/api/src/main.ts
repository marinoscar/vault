import 'reflect-metadata';

import fastifyCookie from '@fastify/cookie';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { DocumentBuilder, SwaggerModule, type OpenAPIObject } from '@nestjs/swagger';

import { HostBetaAppModule } from './app.module';
import { HOST_IDENTITY } from './host-identity';

/** Builds Host Beta (Fastify, the cookie plugin, the `/api` prefix). The tests drive it with `inject`. */
export async function createHostBetaApp(): Promise<NestFastifyApplication> {
  const app = await NestFactory.create<NestFastifyApplication>(HostBetaAppModule, new FastifyAdapter(), { logger: ['error', 'warn'], abortOnError: false });
  await app.register(fastifyCookie as never, { secret: process.env.JWT_SECRET });
  app.setGlobalPrefix('api');
  return app;
}

/** The host's OpenAPI document: its own routes and the Vault packages', in one. */
export function hostBetaOpenApi(app: NestFastifyApplication): OpenAPIObject {
  return SwaggerModule.createDocument(app, new DocumentBuilder().setTitle(`${HOST_IDENTITY.productName} API`).build());
}
