import { friendlyAiError } from './ai-error';

describe('friendlyAiError', () => {
  it('explains a missing key', () => expect(friendlyAiError(new Error('Could not resolve authentication method. Expected one of apiKey'))).toMatch(/ANTHROPIC_API_KEY/));
  it('explains no credits', () => expect(friendlyAiError({ status: 400, message: 'Your credit balance is too low to access the API' })).toMatch(/no credits/));
  it('explains a model the key cannot use', () => expect(friendlyAiError({ status: 404, message: 'model: x' })).toMatch(/DISCOVERY_MODEL/));
  it('explains web search being off', () => expect(friendlyAiError({ status: 400, message: 'web_search tool is not enabled' })).toMatch(/Web search is not enabled/));
  it('explains rate limits and overload', () => {
    expect(friendlyAiError({ status: 429, message: 'x' })).toMatch(/rate-limiting/);
    expect(friendlyAiError({ status: 529, message: 'x' })).toMatch(/overloaded/);
  });
  it('passes unknown errors through', () => expect(friendlyAiError(new Error('boom'))).toBe('boom'));
});
