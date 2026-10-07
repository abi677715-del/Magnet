/** What a partner's content is about (separate from where it lives, which is the platform). */
export const TOPICS = {
  FOOTBALL: 'Football',
  SPORTS: 'Sports',
  PREDICTIONS: 'Predictions',
  BETTING: 'Betting',
  TIPSTERS: 'Tipsters',
  SPORTS_NEWS: 'Sports News',
  MMA: 'MMA',
  BASKETBALL: 'Basketball',
  TENNIS: 'Tennis',
} as const;
export type TopicKey = keyof typeof TOPICS;
export const TOPIC_KEYS = Object.keys(TOPICS) as TopicKey[];

/** Every topic ticked means "no restriction", so it is treated the same as none ticked and nothing is tagged. */
export function effectiveTopics(topics?: string[]): TopicKey[] {
  const picked = [...new Set((topics ?? []).filter((t): t is TopicKey => TOPIC_KEYS.includes(t as TopicKey)))];
  return picked.length === TOPIC_KEYS.length ? [] : picked;
}
