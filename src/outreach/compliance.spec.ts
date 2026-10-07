process.env.ADMIN_API_KEY = 'test-admin-key-0123456789';
import { buildFooter, lintOutreach, unsubscribeToken, verifyUnsubscribeToken } from './compliance';

const GOOD_BODY = 'Hi Sam, I am writing from the affiliate team. Your recent video on the cup final was great. We run a partner programme and would be glad to send the details if useful. 18+ only, and only where legal.';

describe('lintOutreach', () => {
  it('accepts an honest message', () => {
    expect(lintOutreach('Partnership idea for your channel', GOOD_BODY)).toEqual([]);
  });
  it.each([
    ['You are guaranteed to earn'],
    ['This is risk-free'],
    ['It is easy money'],
    ['Earn 5000 USD per month'],
    ['Never lose again'],
    ['Last chance to join'],
    ['Make passive income'],
  ])('flags: %s', (phrase) => {
    expect(lintOutreach('Partnership idea', `${GOOD_BODY} ${phrase}.`).length).toBeGreaterThan(0);
  });
  it('flags a fake reply subject and too-short text', () => {
    expect(lintOutreach('Re: our chat', GOOD_BODY)).toContain('Subject pretends to be a reply or forward');
    expect(lintOutreach('Hello there', 'Hi')).toContain('Message is too short');
  });
});

describe('unsubscribe tokens', () => {
  it('round-trips and is case-insensitive on the address', () => {
    expect(verifyUnsubscribeToken(unsubscribeToken('Sam@Example.com'))).toBe('sam@example.com');
  });
  it('rejects a tampered token or one for another address', () => {
    const t = unsubscribeToken('sam@example.com');
    const [b64, mac] = t.split('.');
    const other = Buffer.from('victim@example.com').toString('base64url');
    expect(verifyUnsubscribeToken(`${other}.${mac}`)).toBeNull();
    expect(verifyUnsubscribeToken(`${b64}.${mac.slice(0, -1)}x`)).toBeNull();
    expect(verifyUnsubscribeToken('garbage')).toBeNull();
    expect(verifyUnsubscribeToken('')).toBeNull();
  });
});

describe('footer', () => {
  it('always carries the opt-out link and the 18+ / responsible-gambling notice', () => {
    const f = buildFooter('sam@example.com');
    expect(f).toMatch(/\/unsubscribe\//);
    expect(f).toMatch(/18\+/);
    expect(f).toMatch(/responsibly/);
  });
});
