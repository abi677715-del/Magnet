import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import { json } from 'express';
import { join } from 'path';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  // Behind Railway/Render's proxy: without this every visitor shares one IP and rate limits misfire.
  app.set('trust proxy', 1);
  app.use(helmet());
  app.use(json({ limit: '100kb' }));
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  // The dashboard is plain files served from the same origin, so no CORS is needed.
  app.useStaticAssets(join(__dirname, '..', 'public'), { prefix: '/dashboard' });

  if ((process.env.ADMIN_API_KEY ?? '').length < 16) {
    console.warn('WARNING: ADMIN_API_KEY is missing or shorter than 16 characters — every API call will be refused.');
  }

  const port = process.env.PORT ?? 4100;
  await app.listen(port);
  console.log(`Affiliate Magnet running on http://localhost:${port}  (dashboard: /dashboard/)`);
}
bootstrap().catch((err) => {
  console.error('Failed to start:', err);
  process.exit(1);
});
