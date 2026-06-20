import { validateQuotes } from '../../src/validation/quoteValidator';
import { PlayStoreReview } from '../../src/ingestion/playStoreScraper';

describe('Quote Validator Unit Tests', () => {
  const mockReviews: PlayStoreReview[] = [
    {
      id: '1',
      userName: 'User 1',
      userImage: '',
      content: 'Groww app is extremely slow and crash on login.',
      score: 1,
      thumbsUp: 5,
      version: '1.0.0',
      date: new Date()
    },
    {
      id: '2',
      userName: 'User 2',
      userImage: '',
      content: 'I love this app, investment process is very easy!',
      score: 5,
      thumbsUp: 2,
      version: '1.0.1',
      date: new Date()
    }
  ];

  test('should validate exact verbatim quotes successfully', () => {
    const quotes = ['extremely slow and crash', 'investment process is very easy!'];
    const result = validateQuotes(quotes, mockReviews);
    
    expect(result.validQuotes).toHaveLength(2);
    expect(result.validQuotes[0]).toBe('extremely slow and crash');
    expect(result.validQuotes[1]).toBe('investment process is very easy!');
    expect(result.warnings).toHaveLength(0);
  });

  test('should handle case-insensitive and punctuation-insensitive matching and fallback to full review content', () => {
    // LLM slightly modified the casing and punctuation
    const quotes = ['Extremely Slow And Crash on login'];
    const result = validateQuotes(quotes, mockReviews);

    expect(result.validQuotes).toHaveLength(1);
    expect(result.validQuotes[0]).toBe('Groww app is extremely slow and crash on login.');
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('Quote modified to match verbatim content');
  });

  test('should discard completely invalid quotes that cannot be mapped', () => {
    const quotes = ['This is a completely fabricated quote that does not exist.'];
    const result = validateQuotes(quotes, mockReviews);

    // Should discard it, but since we ended up with 0 valid quotes, it should fall back to the first review content
    expect(result.validQuotes).toHaveLength(1);
    expect(result.validQuotes[0]).toBe('Groww app is extremely slow and crash on login.');
    expect(result.warnings).toHaveLength(2); // 1 for discarding, 1 for the first review fallback
    expect(result.warnings[0]).toContain('Quote discarded (not found in source texts)');
  });
});
