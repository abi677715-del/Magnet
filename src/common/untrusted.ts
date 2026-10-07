/** Everything scraped from the public web is untrusted: it can't be allowed to close our tags or give orders. */
export function escapeUntrusted(text: string, maxLen: number): string {
  return String(text ?? '')
    .replace(/[<>]/g, (c) => (c === '<' ? '‹' : '›'))
    .slice(0, maxLen);
}
