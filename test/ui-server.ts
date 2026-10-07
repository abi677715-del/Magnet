// Starts the real app with fake Claude search on a fixed port and seeds demo leads, for browser testing.
import 'reflect-metadata';
process.env.ADMIN_API_KEY = 'ui-test-admin-key-0123456789';
process.env.NODE_ENV = 'test';
import { Test } from '@nestjs/testing';
import { ValidationPipe } from '@nestjs/common';
import helmet from 'helmet';
import { join } from 'path';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from '../src/app.module';
import { FakeDiscoverer } from './helpers';
import { AI_DISCOVERER } from '../src/discovery/ai-discovery';

(async () => {
  const disc = new FakeDiscoverer();
  disc.delayMs = 1500;
  disc.result = { searches: 6, seenUrls: ['https://t.me/s/uitelegramtips', 'https://x.com/uixtipster'], candidates: [
    { url: 'https://t.me/uitelegramtips', name: 'UI Telegram Tips', note: 'Daily football tips channel' },
    { url: 'https://x.com/uixtipster', name: 'UI X Tipster', note: 'Posts predictions' },
    { url: 'https://x.com/notinresults', name: 'Invented', note: 'Not real' },
  ] };
  const m = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(AI_DISCOVERER).useValue(disc).compile();
  const app = m.createNestApplication<NestExpressApplication>();
  app.use(helmet());
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.useStaticAssets(join(__dirname, '..', 'public'), { prefix: '/dashboard' });
  await app.listen(4100);
  const api = (p: string, body: unknown) => fetch('http://localhost:4100' + p, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + process.env.ADMIN_API_KEY }, body: JSON.stringify(body) });
  const bio = 'Weekly football betting previews and match analysis for East African fans.';
  await api('/discovery/urls', { urls: ['https://t.me/s/footballpro'] }); // unreachable in the sandbox: saved as a bare link
  console.log('READY');
})();
