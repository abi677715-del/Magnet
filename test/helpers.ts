import { ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { CLASSIFIER_LLM } from '../src/classification/classification.service';
import { ModelAssessment } from '../src/classification/llm';
import { AI_DISCOVERER, AiSearchRequest, AiSearchResult } from '../src/discovery/ai-discovery';

export const KEY = 'e2e-admin-key-0123456789abcdef';

export const GOOD: ModelAssessment = {
  category: 'SPORTS_CONTENT_CREATOR', audience_relevance: 90, content_fit: 90, credibility: 90, promo_experience: 80,
  country_guess: 'KE', language: 'English', strengths: ['Weekly football previews'], concerns: [], red_flags: [], summary: 'A strong fit.',
};

export class FakeLlm {
  modelName = 'fake-model';
  calls: string[] = [];
  byHandle: Record<string, Partial<ModelAssessment> | 'throw'> = {};
  async assess(lead: { handle: string }) {
    this.calls.push(lead.handle);
    const o = this.byHandle[lead.handle];
    if (o === 'throw') throw new Error('upstream exploded');
    return { ...GOOD, ...(o ?? {}) } as ModelAssessment;
  }
}

export class FakeDiscoverer {
  modelName = 'fake-discoverer';
  requests: AiSearchRequest[] = [];
  result: AiSearchResult = { candidates: [], seenUrls: [], searches: 3 };
  delayMs = 0;
  fail: string | null = null;
  async find(req: AiSearchRequest) {
    this.requests.push(req);
    if (this.delayMs) await new Promise((r) => setTimeout(r, this.delayMs));
    if (this.fail) throw new Error(this.fail);
    return this.result;
  }
}

export async function boot() {
  const llm = new FakeLlm();
  const discoverer = new FakeDiscoverer();
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(CLASSIFIER_LLM).useValue(llm)
    .overrideProvider(AI_DISCOVERER).useValue(discoverer)
    .compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>();
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.listen(0);
  const base = (await app.getUrl()).replace('[::1]', 'localhost');
  const db = new PrismaClient();

  async function api(path: string, opts: { method?: string; body?: unknown; key?: string | null; actor?: string } = {}) {
    const res = await fetch(base + path, {
      method: opts.method ?? 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(opts.key === null ? {} : { Authorization: `Bearer ${opts.key ?? KEY}` }),
        ...(opts.actor ? { 'x-actor': opts.actor } : {}),
      },
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    });
    const text = await res.text();
    let json: any = null;
    try { json = JSON.parse(text); } catch { /* html */ }
    return { status: res.status, json, text };
  }

  async function reset() {
    await db.$executeRawUnsafe('TRUNCATE leads, audit_log CASCADE');
    llm.calls = []; llm.byHandle = {};
    discoverer.requests = []; discoverer.result = { candidates: [], seenUrls: [], searches: 3 }; discoverer.delayMs = 0; discoverer.fail = null;
  }
  return { app, api, db, llm, discoverer, reset, close: async () => { await db.$disconnect(); await app.close(); } };
}

export const importLeads = (api: Awaited<ReturnType<typeof boot>>['api'], rows: Record<string, unknown>[]) =>
  api('/discovery/import', { method: 'POST', body: { format: 'json', data: rows } });
