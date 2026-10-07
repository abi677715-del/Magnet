/** Turns an Anthropic API failure into a sentence a person can act on. Falls back to the original message. */
export function friendlyAiError(err: unknown): string {
  const e = err as { status?: number; message?: string; error?: { error?: { message?: string } } };
  const raw = e?.error?.error?.message ?? e?.message ?? 'The AI search failed';
  const text = raw.toLowerCase();
  if (text.includes('credit balance')) return 'The Anthropic account has no credits. Add credits under Plans & Billing in console.anthropic.com (trial credits may have run out), then try again.';
  if (text.includes('could not resolve authentication') || e?.status === 401) return 'The Anthropic API key is missing or wrong. Set ANTHROPIC_API_KEY on the server to a valid key and redeploy.';
  if (text.includes('web search') || text.includes('web_search')) return 'Web search is not enabled for this Anthropic account. A workspace admin can turn it on in console.anthropic.com under Settings > Privacy, and trial accounts may not have it. Details: ' + raw;
  if (e?.status === 404 || text.includes('model')) return 'This API key cannot use the configured model. Set DISCOVERY_MODEL on the server to one your plan allows (for example claude-sonnet-5-5). Details: ' + raw;
  if (e?.status === 403) return 'The Anthropic account is not allowed to do this (a trial or restricted plan?). Details: ' + raw;
  if (e?.status === 429) return 'Anthropic is rate-limiting this key. Wait a minute and try again, or raise the limits on the account.';
  if (e?.status === 529 || (e?.status ?? 0) >= 500) return 'Anthropic is temporarily overloaded. Try again in a minute.';
  return raw;
}
