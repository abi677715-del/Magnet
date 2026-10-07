// Starts the real app with fake Claude/mailer on a fixed port and seeds demo leads, for browser testing.
import 'reflect-metadata';
process.env.ADMIN_API_KEY = 'ui-test-admin-key-0123456789';
process.env.NODE_ENV = 'test';
import { Test } from '@nestjs/testing';
import { ValidationPipe } from '@nestjs/common';
import helmet from 'helmet';
import { join } from 'path';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from '../src/app.module';
import { CLASSIFIER_LLM } from '../src/classification/classification.service';
import { FakeLlm, FakeDiscoverer } from './helpers';
import { AI_DISCOVERER } from '../src/discovery/ai-discovery';

(async () => {
  const llm = new FakeLlm();
  llm.byHandle = {
    kidscorner: { red_flags: ['AUDIENCE_INCLUDES_MINORS'], concerns: ['Videos are made for children'] },
    sureodds: { red_flags: ['GUARANTEED_WINS_CLAIMS'], concerns: ['Promises "100% sure wins"'] },
    smalltips: { audience_relevance: 45, content_fit: 50, credibility: 55, promo_experience: 10, strengths: [] },
  };
  const disc = new FakeDiscoverer();
  disc.delayMs = 1500;
  disc.result = { searches: 6, seenUrls: ['https://t.me/s/uitelegramtips', 'https://x.com/uixtipster'], candidates: [
    { url: 'https://t.me/uitelegramtips', name: 'UI Telegram Tips', note: 'Daily football tips channel' },
    { url: 'https://x.com/uixtipster', name: 'UI X Tipster', note: 'Posts predictions' },
    { url: 'https://x.com/notinresults', name: 'Invented', note: 'Not real' },
  ] };
  const m = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(CLASSIFIER_LLM).useValue(llm).overrideProvider(AI_DISCOVERER).useValue(disc).compile();
  const app = m.createNestApplication<NestExpressApplication>();
  app.use(helmet());
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.useStaticAssets(join(__dirname, '..', 'public'), { prefix: '/dashboard' });
  await app.listen(4100);
  const api = (p: string, body: unknown) => fetch('http://localhost:4100' + p, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + process.env.ADMIN_API_KEY }, body: JSON.stringify(body) });
  const bio = 'Weekly football betting previews and match analysis for East African fans.';
  await api('/discovery/import', { format: 'json', data: [
    { platform: 'youtube', handle: 'footballpro', name: 'Football Pro Tips', followers: 240000, country: 'KE', bio, email: 'pro@example.com' },
    { platform: 'telegram', handle: 'xsstest', name: '=HYPERLINK("http://evil.example","x") <img src=x onerror="window.__pwned=1">', followers: 90000, country: 'NG', bio: '<script>window.__pwned=1</script> ' + bio, email: 'xss@example.com' },
    { platform: 'youtube', handle: 'kidscorner', name: 'Kids Corner Football', followers: 500000, country: 'KE', bio },
    { platform: 'tiktok', handle: 'sureodds', name: 'Sure Odds', followers: 800000, country: 'KE', bio },
    { platform: 'instagram', handle: 'smalltips', name: 'Small Tips', followers: 800, country: 'ET', bio },
    { platform: 'tiktok', handle: 'barelink', name: 'Bare Link' },
  ] });
  await api('/classification/run', {});
  console.log('READY');
})();
