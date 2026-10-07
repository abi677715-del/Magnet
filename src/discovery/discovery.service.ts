import { Injectable } from '@nestjs/common';
import { Platform } from '@prisma/client';
import { YoutubeProvider } from './providers/youtube.provider';
import { WebProvider } from './providers/web.provider';
import { IngestService } from './ingest.service';
import { ParsedUrl } from './url-parser';
import { RawLead } from './types';

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
}
