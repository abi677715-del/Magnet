import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { Platform } from '@prisma/client';
import { RawLead } from '../types';

const API = 'https://www.googleapis.com/youtube/v3';

interface YtChannel {
  id: string;
  snippet: { title: string; description: string; customUrl?: string; country?: string; defaultLanguage?: string };
  statistics?: { subscriberCount?: string; hiddenSubscriberCount?: boolean };
  contentDetails?: { relatedPlaylists?: { uploads?: string } };
}

/** Official YouTube Data API (needs YOUTUBE_API_KEY). A keyword search costs ~100 quota units, so it's run on demand, not on a timer. */
@Injectable()
export class YoutubeProvider {
  get configured() {
    return !!process.env.YOUTUBE_API_KEY;
  }

  private async call<T>(path: string, params: Record<string, string>): Promise<T> {
    if (!this.configured) throw new ServiceUnavailableException('YouTube search is not set up: add YOUTUBE_API_KEY.');
    const qs = new URLSearchParams({ ...params, key: process.env.YOUTUBE_API_KEY! });
    const res = await fetch(`${API}/${path}?${qs}`, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      const reason = /quotaExceeded/.test(body) ? 'daily quota used up' : `HTTP ${res.status}`;
      throw new ServiceUnavailableException(`YouTube API error: ${reason}`);
    }
    return (await res.json()) as T;
  }

  async search(query: string, limit = 15, opts: { regionCode?: string; language?: string } = {}): Promise<RawLead[]> {
    const found = await this.call<{ items?: { id: { channelId: string } }[] }>('search', {
      part: 'snippet',
      type: 'channel',
      q: query,
      maxResults: String(Math.min(Math.max(limit, 1), 50)),
      ...(opts.regionCode ? { regionCode: opts.regionCode.toUpperCase() } : {}),
      ...(opts.language ? { relevanceLanguage: opts.language } : {}),
    });
    const ids = (found.items ?? []).map((i) => i.id.channelId).filter(Boolean);
    return this.byIds(ids, 'youtube-search');
  }

  /** Resolves a pasted channel link (@handle or channel id) to a full lead. */
  async resolve(handleOrId: string, source = 'url'): Promise<RawLead | null> {
    const isId = /^UC[\w-]{20,}$/.test(handleOrId);
    const data = await this.call<{ items?: YtChannel[] }>('channels', {
      part: 'snippet,statistics,contentDetails',
      ...(isId ? { id: handleOrId } : { forHandle: handleOrId.startsWith('@') ? handleOrId : `@${handleOrId}` }),
    });
    const channel = data.items?.[0];
    return channel ? this.toLead(channel, source) : null;
  }

  private async byIds(ids: string[], source: string): Promise<RawLead[]> {
    if (!ids.length) return [];
    const data = await this.call<{ items?: YtChannel[] }>('channels', {
      part: 'snippet,statistics,contentDetails',
      id: ids.join(','),
      maxResults: '50',
    });
    return Promise.all((data.items ?? []).map((c) => this.toLead(c, source)));
  }

  private async toLead(c: YtChannel, source: string): Promise<RawLead> {
    const custom = c.snippet.customUrl?.replace(/^@/, '').toLowerCase();
    const subs = c.statistics?.hiddenSubscriberCount ? null : Number(c.statistics?.subscriberCount ?? NaN);
    const uploads = c.contentDetails?.relatedPlaylists?.uploads;
    let recent: RawLead['recentContent'] = [];
    if (uploads) {
      try {
        const vids = await this.call<{ items?: { snippet: { title: string; description: string; publishedAt: string; resourceId: { videoId: string } } }[] }>(
          'playlistItems',
          { part: 'snippet', playlistId: uploads, maxResults: '6' },
        );
        recent = (vids.items ?? []).map((v) => ({
          title: v.snippet.title,
          text: v.snippet.description.slice(0, 500),
          url: `https://www.youtube.com/watch?v=${v.snippet.resourceId.videoId}`,
          publishedAt: v.snippet.publishedAt,
        }));
      } catch {
        // Recent videos are a nice-to-have; the channel is still worth saving without them.
      }
    }
    return {
      platform: Platform.YOUTUBE,
      handle: custom || c.id,
      url: custom ? `https://www.youtube.com/@${custom}` : `https://www.youtube.com/channel/${c.id}`,
      displayName: c.snippet.title,
      bio: c.snippet.description,
      followers: subs !== null && Number.isFinite(subs) ? subs : null,
      country: c.snippet.country ?? null,
      language: c.snippet.defaultLanguage ?? null,
      recentContent: recent,
      source,
    };
  }
}
