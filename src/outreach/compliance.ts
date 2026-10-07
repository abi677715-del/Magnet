import { createHmac, timingSafeEqual } from 'crypto';
import { config } from '../common/config';

/** Phrases that must never appear in a recruitment email for a betting brand. */
const FORBIDDEN: [RegExp, string][] = [
  [/guarantee[d]?\b/i, 'promises or guarantees'],
  [/risk[- ]?free/i, '"risk-free"'],
  [/easy money|get rich|quick money|passive income/i, 'easy-money language'],
  [/sure (win|bet|thing)|can'?t lose|never lose|always win/i, 'winning guarantees'],
  [/\b\d[\d,.]*\s*(\$|usd|eur|€|£|birr|etb)\s*(per|a|\/)\s*(day|week|month)/i, 'specific income claims'],
  [/last chance|act now|expires (today|tonight)|only \d+ spots/i, 'false urgency'],
];

export function lintOutreach(subject: string, body: string): string[] {
  const text = `${subject}\n${body}`;
  const problems = FORBIDDEN.filter(([re]) => re.test(text)).map(([, label]) => `Contains ${label}`);
  if (subject.trim().length < 3) problems.push('Subject is too short');
  if (subject.length > 120) problems.push('Subject is too long');
  if (body.trim().length < 40) problems.push('Message is too short');
  if (body.length > 3000) problems.push('Message is too long');
  if (/^(re|fwd?):/i.test(subject.trim())) problems.push('Subject pretends to be a reply or forward');
  return problems;
}

const secret = () => process.env.UNSUBSCRIBE_SECRET || process.env.ADMIN_API_KEY || '';

export function unsubscribeToken(email: string): string {
  const b64 = Buffer.from(email.toLowerCase()).toString('base64url');
  const mac = createHmac('sha256', secret()).update(b64).digest('base64url').slice(0, 24);
  return `${b64}.${mac}`;
}

/** Returns the email if the token is genuine, otherwise null. */
export function verifyUnsubscribeToken(token: string): string | null {
  const [b64, mac] = String(token).split('.');
  if (!b64 || !mac || !secret()) return null;
  const expected = createHmac('sha256', secret()).update(b64).digest('base64url').slice(0, 24);
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const email = Buffer.from(b64, 'base64url').toString('utf8');
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
  } catch {
    return null;
  }
}

export function unsubscribeUrl(email: string): string {
  return `${config.publicBaseUrl}/unsubscribe/${unsubscribeToken(email)}`;
}

/** Added by code at send time so a manager can't accidentally delete the opt-out or the legal notice. */
export function buildFooter(email: string): string {
  return [
    '',
    '--',
    config.senderName,
    config.senderCompanyAddress,
    '',
    `You are receiving this one-time message because your public profile suggests you may be interested in the ${config.productName} partner programme. If you'd rather not hear from us, unsubscribe here and we will not contact you again: ${unsubscribeUrl(email)}`,
    '',
    '18+ only. Gambling can be addictive — please play responsibly. Check that online betting and its promotion are legal where you and your audience live.',
  ]
    .filter((line, i, arr) => !(line === '' && arr[i - 1] === ''))
    .join('\n');
}
