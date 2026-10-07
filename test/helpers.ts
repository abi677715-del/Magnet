import { ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { IngestService } from '../src/discovery/ingest.service';
import { AI_DISCOVERER, AiSearchRequest, AiSearchResult } from '../src/discovery/ai-discovery';

export const KEY = 'e2e-admin-key-0123456789abcdef';

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
  const discoverer = new FakeDiscoverer();
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
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
    discoverer.requests = []; discoverer.result = { candidates: [], seenUrls: [], searches: 3 }; discoverer.delayMs = 0; discoverer.fail = null;
  }
  return { app, api, db, discoverer, reset, close: async () => { await db.$disconnect(); await app.close(); } };
}

/** Puts leads in the way a discovery would. There is no import endpoint any more. */
export async function importLeads(c: { app: { get: (t: any) => any } }, rows: Record<string, any>[]) {
  const ingest: IngestService = c.app.get(IngestService);
  return ingest.upsertMany(rows.map((r) => ({
    platform: String(r.platform).toUpperCase() as any, handle: r.handle, url: r.url ?? `https://example.com/${r.handle}`, displayName: r.name ?? r.handle,
    bio: r.bio, followers: r.followers, country: r.country, contactEmail: r.email, source: 'test',
  })));
}
