import { Platform } from '@prisma/client';
import { findEmails, metaContent, pageTitle, stripTags } from './html';
import { isAllowedByRobots } from './robots';
import { parseLeadUrl } from './url-parser';
import { parseCount } from './providers/web.provider';
import { isPrivateAddress } from '../common/safe-fetch';

describe('parseLeadUrl', () => {
  const cases: [string, Platform, string][] = [
    ['https://www.youtube.com/@FootballTips', Platform.YOUTUBE, 'footballtips'],
    ['youtube.com/channel/UCabcdefghijklmnopqrstuv', Platform.YOUTUBE, 'UCabcdefghijklmnopqrstuv'],
    ['https://www.tiktok.com/@BetGuru?lang=en', Platform.TIKTOK, 'betguru'],
    ['https://instagram.com/Some.Tipster/', Platform.INSTAGRAM, 'some.tipster'],
    ['https://www.facebook.com/FootballTipsKE/', Platform.FACEBOOK, 'footballtipske'],
    ['https://twitter.com/BetTips', Platform.X, 'bettips'],
    ['https://x.com/BetTips/status/123', Platform.X, 'bettips'],
    ['https://t.me/s/footballchannel', Platform.TELEGRAM, 'footballchannel'],
    ['https://www.reddit.com/r/SoccerBetting', Platform.REDDIT, 'r/soccerbetting'],
    ['https://www.reddit.com/user/Foo', Platform.REDDIT, 'u/foo'],
    ['https://www.bettingreview.com/best-bookmakers', Platform.WEBSITE, 'bettingreview.com'],
    ['bettingreview.com', Platform.WEBSITE, 'bettingreview.com'],
  ];
  it.each(cases)('%s', (url, platform, handle) => {
    expect(parseLeadUrl(url)).toMatchObject({ platform, handle });
  });
  it.each(['', 'not a url', 'https://youtube.com/watch?v=abc', 'https://t.me/+AbCdEf', 'https://instagram.com/p/abc', 'https://facebook.com/groups/123', 'https://facebook.com/profile.php?id=1', 'javascript:alert(1)', 'ftp://x.com/a'])(
    'rejects %j',
    (u) => expect(parseLeadUrl(u)).toBeNull(),
  );
});

describe('html helpers', () => {
  const html = `<html><head><title>Best &amp; Honest Tips</title><meta name="description" content="Football picks &quot;daily&quot;"></head>
    <body><script>var a="x@y.com"</script><a href="mailto:Partners@Tips.com?subject=hi">mail</a><p>Or write info@tips.com. noreply@tips.com</p></body></html>`;
  it('reads title and meta', () => {
    expect(pageTitle(html)).toBe('Best & Honest Tips');
    expect(metaContent(html, 'description')).toBe('Football picks "daily"');
  });
  it('strips scripts and tags', () => {
    expect(stripTags(html)).not.toMatch(/var a/);
  });
  it('refuses emails smuggling line breaks or extra recipients', () => {
    expect(findEmails('<a href="mailto:a@b.com%0ABcc:victim@x.com">x</a><a href="mailto:c@d.com,e@f.com">y</a><a href="mailto:ok@fine.com">z</a>')).toEqual(['ok@fine.com']);
  });
  it('finds only published emails and drops junk', () => {
    expect(findEmails(html)).toEqual(['partners@tips.com', 'info@tips.com']);
  });
});

describe('robots.txt', () => {
  const robots = 'User-agent: *\nDisallow: /private\nAllow: /private/public\n\nUser-agent: AffiliateMagnetBot\nDisallow: /blocked\n';
  it('uses the group for our bot when there is one', () => {
    expect(isAllowedByRobots(robots, '/blocked/x')).toBe(false);
    expect(isAllowedByRobots(robots, '/private')).toBe(true); // our group doesn't mention it
  });
  it('falls back to * and honours the longest matching rule', () => {
    const r = 'User-agent: *\nDisallow: /private\nAllow: /private/public\n';
    expect(isAllowedByRobots(r, '/private/secret')).toBe(false);
    expect(isAllowedByRobots(r, '/private/public/page')).toBe(true);
    expect(isAllowedByRobots(r, '/')).toBe(true);
  });
  it('treats a total disallow as a block, and an empty file as allowed', () => {
    expect(isAllowedByRobots('User-agent: *\nDisallow: /', '/')).toBe(false);
    expect(isAllowedByRobots('', '/')).toBe(true);
  });
});

describe('safe-fetch address check', () => {
  it.each(['127.0.0.1', '10.1.2.3', '172.16.0.1', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', 'fe80::1', 'fd00::1', '::ffff:127.0.0.1'])(
    'refuses private address %s',
    (ip) => expect(isPrivateAddress(ip)).toBe(true),
  );
  it.each(['8.8.8.8', '1.1.1.1', '172.32.0.1', '93.184.216.34'])('allows public address %s', (ip) => expect(isPrivateAddress(ip)).toBe(false));
});

describe('parseCount', () => {
  it.each([['12.5K', 12500], ['1.2M', 1200000], ['3,400', 3400], ['950', 950], ['12 345', 12345]])('%s', (raw, n) => expect(parseCount(raw as string)).toBe(n));
  it('rejects junk', () => expect(parseCount('lots')).toBeNull());
});
