import './load-env';
import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import type { NextFunction, Request, Response } from 'express';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { isPublicKeywordMarketPath } from './ads/keyword-market-public-path';
import { SESSION_COOKIE_NAME } from './auth/session-cookie';
import { config } from './config';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { cors: false });
  // The production API only accepts traffic from the loopback Nginx proxy.
  // Trusting that hop lets Express derive the real client IP without trusting
  // arbitrary forwarded headers from remote clients.
  app.set('trust proxy', 'loopback');
  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(cookieParser());
  app.use((request: Request, response: Response, next: NextFunction) => {
    if (!isPublicKeywordMarketPath(request.path)) return next();
    response.setHeader('Access-Control-Allow-Origin', '*');
    response.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    response.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (request.method === 'OPTIONS') return response.status(204).send();
    return next();
  });
  app.enableCors({
    origin(origin, callback) {
      callback(null, !origin || config.allowedWebOrigins.includes(origin));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  });
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
  app.setGlobalPrefix('v1');
  app.enableShutdownHooks();

  const document = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle('precommunity chain ledger API')
      .setVersion('1.0.0')
      .addCookieAuth(SESSION_COOKIE_NAME)
      .build(),
  );
  SwaggerModule.setup('docs', app, document);
  await app.listen(config.PORT, config.HOST);
}

void bootstrap();
