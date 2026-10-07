import { lookup } from 'dns/promises';
import { isIP } from 'net';

const USER_AGENT = 'AffiliateMagnetBot/0.1 (partner research; respects robots.txt)';

export function isPrivateAddress(ip: string): boolean {
  if (isIP(ip) === 4) {
    const [a, b] = ip.split('.').map(Number);
    return (
      a === 10 ||
      a === 127 ||
      a === 0 ||
      (a === 169 && b === 254) || // link-local, cloud metadata
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127) || // carrier-grade NAT
      a >= 224
    );
  }
  const v6 = ip.toLowerCase();
  if (v6.startsWith('::ffff:')) return isPrivateAddress(v6.slice(7));
  return v6 === '::1' || v6 === '::' || v6.startsWith('fc') || v6.startsWith('fd') || v6.startsWith('fe80');
}

export async function assertPublicUrl(raw: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('Not a valid URL');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('Only http(s) URLs are allowed');
  if (url.username || url.password) throw new Error('URLs with credentials are not allowed');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const addresses = isIP(host) ? [{ address: host }] : await lookup(host, { all: true });
  if (!addresses.length || addresses.some((a) => isPrivateAddress(a.address))) {
    throw new Error('That address is not a public website');
  }
  return url;
}

export interface FetchedPage {
  url: string;
  status: number;
  contentType: string;
  text: string;
}

/**
 * Fetches a public web page on behalf of a manager. Because the URL comes from
 * a person, it is treated as hostile: public addresses only (every redirect is
 * re-checked), a short timeout, and a hard size cap.
 */
export async function safeFetchText(raw: string, opts: { maxBytes?: number; timeoutMs?: number } = {}): Promise<FetchedPage> {
  const maxBytes = opts.maxBytes ?? 1_000_000;
  let current = await assertPublicUrl(raw);
  for (let hop = 0; hop < 4; hop++) {
    const res = await fetch(current, {
      redirect: 'manual',
      headers: { 'User-Agent': USER_AGENT, Accept: 'text/html,text/plain;q=0.9,*/*;q=0.5' },
      signal: AbortSignal.timeout(opts.timeoutMs ?? 8000),
    });
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      current = await assertPublicUrl(new URL(res.headers.get('location')!, current).toString());
      continue;
    }
    const chunks: Buffer[] = [];
    let total = 0;
    if (res.body) {
      for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
        total += chunk.length;
        if (total > maxBytes) break;
        chunks.push(Buffer.from(chunk));
      }
    }
    return {
      url: current.toString(),
      status: res.status,
      contentType: res.headers.get('content-type') ?? '',
      text: Buffer.concat(chunks).toString('utf8'),
    };
  }
  throw new Error('Too many redirects');
}

export { USER_AGENT };
