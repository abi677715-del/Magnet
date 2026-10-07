import { Platform } from '@prisma/client';

export interface ParsedUrl {
  platform: Platform;
  handle: string;
  url: string;
}

const clean = (s: string) => decodeURIComponent(s).trim().replace(/^@/, '').toLowerCase();

/** Turns whatever a person pastes (a channel link, a profile link, a website) into platform + handle. Returns null if it isn't a usable link. */
export function parseLeadUrl(input: string): ParsedUrl | null {
  let raw = input.trim();
  if (!raw) return null;
  if (!/^https?:\/\//i.test(raw)) raw = `https://${raw}`;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  const host = u.hostname.toLowerCase().replace(/^(www|m|mobile)\./, '');
  if (!host.includes('.')) return null;
  const parts = u.pathname.split('/').filter(Boolean);

  const make = (platform: Platform, handle: string, url: string): ParsedUrl | null =>
    handle ? { platform, handle: handle.slice(0, 100), url } : null;

  if (host === 'youtube.com' || host === 'youtu.be') {
    const first = parts[0] ?? '';
    if (first.startsWith('@')) return make(Platform.YOUTUBE, clean(first), `https://www.youtube.com/${first}`);
    if (['channel', 'c', 'user'].includes(first) && parts[1]) {
      return make(Platform.YOUTUBE, first === 'channel' ? parts[1] : clean(parts[1]), `https://www.youtube.com/${first}/${parts[1]}`);
    }
    return null; // a video or playlist link isn't a channel
  }
  if (host === 'tiktok.com') {
    const first = parts[0] ?? '';
    return first.startsWith('@') ? make(Platform.TIKTOK, clean(first), `https://www.tiktok.com/${first}`) : null;
  }
  if (host === 'instagram.com') {
    const first = parts[0] ?? '';
    if (!first || ['p', 'reel', 'reels', 'explore', 'stories', 'accounts'].includes(first)) return null;
    return make(Platform.INSTAGRAM, clean(first), `https://www.instagram.com/${first}`);
  }
  if (host === 'facebook.com' || host === 'fb.com') {
    const first = parts[0] ?? '';
    if (first === 'profile.php') return null;
    if (!first || ['groups', 'watch', 'share', 'sharer', 'sharer.php', 'story.php', 'photo', 'photo.php', 'events', 'marketplace', 'login', 'login.php', 'dialog', 'plugins', 'help', 'policies', 'reel', 'reels', 'stories', 'hashtag', 'pages'].includes(first)) return null;
    return make(Platform.FACEBOOK, clean(first), `https://www.facebook.com/${first}`);
  }
  if (host === 'x.com' || host === 'twitter.com') {
    const first = parts[0] ?? '';
    if (!first || ['i', 'home', 'search', 'explore', 'intent', 'share'].includes(first)) return null;
    return make(Platform.X, clean(first), `https://x.com/${first}`);
  }
  if (host === 't.me' || host === 'telegram.me') {
    const name = parts[0] === 's' ? parts[1] : parts[0];
    if (!name || name.startsWith('+') || name === 'joinchat') return null; // private invite links can't be viewed
    return make(Platform.TELEGRAM, clean(name), `https://t.me/${name}`);
  }
  if (host === 'reddit.com' || host === 'old.reddit.com') {
    if ((parts[0] === 'user' || parts[0] === 'u') && parts[1]) return make(Platform.REDDIT, `u/${clean(parts[1])}`, `https://www.reddit.com/user/${parts[1]}`);
    if (parts[0] === 'r' && parts[1]) return make(Platform.REDDIT, `r/${clean(parts[1])}`, `https://www.reddit.com/r/${parts[1]}`);
    return null;
  }
  return make(Platform.WEBSITE, host, `${u.protocol}//${u.hostname}/`);
}

export function parsePlatform(value: string): Platform | null {
  const v = value.trim().toUpperCase().replace(/^TWITTER$/, 'X');
  return (Object.values(Platform) as string[]).includes(v) ? (v as Platform) : null;
}
