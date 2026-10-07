import { Injectable } from '@nestjs/common';
import { Platform } from '@prisma/client';
import { safeFetchText, assertPublicUrl } from '../../common/safe-fetch';
import { findEmails, metaContent, pageTitle, stripTags, decodeEntities } from '../html';
import { isAllowedByRobots } from '../robots';
import { RawLead } from '../types';

/** Reads public pages (Telegram channel previews, websites) politely: robots.txt first, small downloads, public hosts only. */
@Injectable()
export class WebProvider {
  async telegram(handle: string): Promise<RawLead | null> {
    const page = await safeFetchText(`https://t.me/s/${encodeURIComponent(handle)}`);
    if (page.status !== 200 || !/tgme_channel_info|tgme_widget_message/.test(page.text)) return null; // private, missing, or not a channel
    const title = decodeEntities(page.text.match(/tgme_channel_info_header_title[^>]*>(?:<[^>]+>)*([^<]+)/)?.[1] ?? handle).trim();
    const bio = stripTags(page.text.match(/tgme_channel_info_description[^>]*>([\s\S]*?)<\/div>/)?.[1] ?? '');
    const subs = page.text.match(/([\d.,]+)\s*([KkMm]?)\s*<div class="tgme_channel_info_counter_label">\s*subscribers/i)
      ?? page.text.match(/tgme_channel_info_counter"><span class="counter_value">([\d.,KkMm ]+)<\/span>\s*<span class="counter_type">subscribers/i);
    const messages = [...page.text.matchAll(/tgme_widget_message_text[^>]*>([\s\S]*?)<\/div>/g)]
      .slice(-6)
      .map((m) => ({ text: stripTags(m[1]).slice(0, 500) }))
      .filter((m) => m.text);
    return {
      platform: Platform.TELEGRAM,
      handle: handle.toLowerCase(),
      url: `https://t.me/${handle}`,
      displayName: title,
      bio,
      followers: subs ? parseCount(subs[1] + (subs[2] ?? '')) : null,
      contactEmail: findEmails(bio)[0] ?? null,
      recentContent: messages,
      source: 'url',
    };
  }

  async website(startUrl: string): Promise<RawLead | null> {
    const url = await assertPublicUrl(startUrl);
    const host = url.hostname.replace(/^www\./, '').toLowerCase();

    try {
      const robots = await safeFetchText(`${url.origin}/robots.txt`, { maxBytes: 100_000, timeoutMs: 5000 });
      if (robots.status === 200 && !isAllowedByRobots(robots.text, url.pathname || '/')) return null;
    } catch {
      // No readable robots.txt means no restriction.
    }

    const page = await safeFetchText(url.toString());
    if (page.status !== 200 || !/html|text/i.test(page.contentType)) return null;

    let emails = findEmails(page.text);
    if (!emails.length) {
      const contactHref = page.text.match(/href=["']([^"']*(?:contact|about)[^"']*)["']/i)?.[1];
      if (contactHref) {
        try {
          const contactUrl = new URL(decodeEntities(contactHref), page.url);
          if (contactUrl.hostname.replace(/^www\./, '') === host) {
            emails = findEmails((await safeFetchText(contactUrl.toString(), { maxBytes: 500_000, timeoutMs: 6000 })).text);
          }
        } catch {
          // A broken contact link just means no email.
        }
      }
    }
    const description = metaContent(page.text, 'description') ?? metaContent(page.text, 'og:description') ?? '';
    const body = stripTags(page.text).slice(0, 1500);
    return {
      platform: Platform.WEBSITE,
      handle: host,
      url: `${url.protocol}//${url.hostname}/`,
      displayName: (metaContent(page.text, 'og:site_name') ?? pageTitle(page.text) ?? host).slice(0, 120),
      bio: [description, body].filter(Boolean).join('\n\n').slice(0, 3000),
      contactEmail: emails[0] ?? null,
      recentContent: [{ title: pageTitle(page.text) ?? '', text: body.slice(0, 500), url: page.url }],
      language: page.text.match(/<html[^>]+lang=["']([a-zA-Z-]+)["']/i)?.[1] ?? null,
      source: 'url',
    };
  }
}

export function parseCount(raw: string): number | null {
  const m = raw.replace(/\s/g, '').match(/^([\d.,]+)([KkMm]?)$/);
  if (!m) return null;
  let n = parseFloat(m[1].replace(/,/g, m[2] ? '.' : ''));
  if (!Number.isFinite(n)) return null;
  if (/k/i.test(m[2])) n *= 1_000;
  if (/m/i.test(m[2])) n *= 1_000_000;
  return Math.round(n);
}
