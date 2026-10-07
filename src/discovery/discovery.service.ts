import { Injectable } from '@nestjs/common';
import { Platform } from '@prisma/client';
import { YoutubeProvider } from './providers/youtube.provider';
import { WebProvider } from './providers/web.provider';
import { IngestService } from './ingest.service';
import { ParsedUrl, parseLeadUrl } from './url-parser';
import { RawLead } from './types';

export interface UrlOutcome {
  url: string;
  status: 'saved' | 'skipped';
  note?: string;
  leadId?: string;
}

@Injectable()
export class DiscoveryService {
  constructor(
    private youtube: YoutubeProvider,
    private web: WebProvider,
    private ingest: IngestService,
  ) {}

  /**
   * Reads a lead in the best way available for its platform. `enriched` is true
   * only when the data came straight from the source (API or the page itself),
   * not from a link we couldn't open.
   */
  async readLead(parsed: ParsedUrl, source: string): Promise<{ raw: RawLead; enriched: boolean }> {
    let raw: RawLead | null = null;
    if (parsed.platform === Platform.YOUTUBE && this.youtube.configured) raw = await this.youtube.resolve(parsed.handle, source);
    else if (parsed.platform === Platform.TELEGRAM) raw = await this.web.telegram(parsed.handle);
    else if (parsed.platform === Platform.WEBSITE) raw = await this.web.website(parsed.url);
    if (raw) return { raw: { ...raw, source }, enriched: true };
    return { raw: { platform: parsed.platform, handle: parsed.handle, url: parsed.url, displayName: parsed.handle, source }, enriched: false };
  }

  /** Paste links in any mix — each is read in the best way available for its platform. */
  async addUrls(urls: string[]): Promise<UrlOutcome[]> {
    const out: UrlOutcome[] = [];
    for (const input of urls.slice(0, 50)) {
      const parsed = parseLeadUrl(input);
      if (!parsed) {
        out.push({ url: input, status: 'skipped', note: "Doesn't look like a channel, profile or website link." });
        continue;
      }
      try {
        const { raw, enriched } = await this.readLead(parsed, 'url');
        // TikTok, Instagram, Facebook, X, Reddit (and anything we couldn't read) can't be read automatically —
        // save the link so nothing is lost; details can be added later.
        const note = enriched
          ? undefined
          : parsed.platform === Platform.WEBSITE || parsed.platform === Platform.TELEGRAM
            ? 'Could not read this page (blocked, private or not found) — saved as a bare link.'
            : 'Saved as a link. This platform cannot be read automatically — add details by hand if you need them.';
        const saved = await this.ingest.upsert(raw);
        out.push({ url: input, status: 'saved', leadId: saved.id, note });
      } catch (err) {
        out.push({ url: input, status: 'skipped', note: err instanceof Error ? err.message : 'Failed' });
      }
    }
    return out;
  }
}
