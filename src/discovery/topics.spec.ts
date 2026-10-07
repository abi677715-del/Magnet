import { effectiveTopics, TOPIC_KEYS, TOPICS } from './topics';

describe('effectiveTopics', () => {
  it('keeps a subset, dropping duplicates and unknown or inherited names', () => {
    expect(effectiveTopics(['MMA', 'TENNIS', 'MMA', 'toString', 'constructor', 'NOPE'])).toEqual(['MMA', 'TENNIS']);
  });
  it('treats none, and all nine, as no restriction', () => {
    expect(effectiveTopics()).toEqual([]);
    expect(effectiveTopics([])).toEqual([]);
    expect(effectiveTopics(TOPIC_KEYS)).toEqual([]);
  });
  it('has the nine topics', () => {
    expect(Object.values(TOPICS)).toEqual(['Football', 'Sports', 'Predictions', 'Betting', 'Tipsters', 'Sports News', 'MMA', 'Basketball', 'Tennis']);
  });
});
