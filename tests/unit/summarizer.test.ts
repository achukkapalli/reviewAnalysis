import { getCentroidClosestReviews, summarizeCluster } from '../../src/reasoning/summarizer';
import { PlayStoreReview } from '../../src/ingestion/playStoreScraper';

jest.mock('groq-sdk', () => {
  return {
    Groq: jest.fn().mockImplementation(() => {
      return {
        chat: {
          completions: {
            create: jest.fn().mockRejectedValue(new Error('Simulated Groq API Error'))
          }
        }
      };
    })
  };
});

describe('Summarizer Unit Tests', () => {
  const mockReviews: PlayStoreReview[] = [
    { id: '1', userName: 'A', userImage: '', content: 'Fast app', score: 5, thumbsUp: 0, version: '', date: new Date() },
    { id: '2', userName: 'B', userImage: '', content: 'Slow app', score: 2, thumbsUp: 0, version: '', date: new Date() },
    { id: '3', userName: 'C', userImage: '', content: 'Crash app', score: 1, thumbsUp: 0, version: '', date: new Date() }
  ];

  // 3-dimensional mock embeddings for simplicity
  const mockEmbeddings = [
    [1, 0, 0], // A
    [0, 1, 0], // B
    [0, 0, 1]  // C
  ];

  test('should return all reviews if count is below maxCount', () => {
    const result = getCentroidClosestReviews(mockReviews, mockEmbeddings, [0, 1, 2], 5);
    expect(result).toHaveLength(3);
    expect(result[0].id).toBe('1');
  });

  test('should sort reviews by closeness to centroid when count exceeds maxCount', () => {
    // Indices: 0 (A), 1 (B)
    // Centroid of [1,0,0] and [0,1,0] is [0.5, 0.5, 0]
    // Distance of A [1,0,0] to centroid is sqrt(0.25 + 0.25) = sqrt(0.5) = 0.707
    // Distance of B [0,1,0] to centroid is sqrt(0.25 + 0.25) = sqrt(0.5) = 0.707
    // Distance of C [0,0,1] to centroid is sqrt(0.25 + 0.25 + 1) = sqrt(1.5) = 1.22
    
    // We select maxCount = 2
    const result = getCentroidClosestReviews(mockReviews, mockEmbeddings, [0, 1, 2], 2);
    expect(result).toHaveLength(2);
    // Should contain A and B, which are closer to the centroid of the cluster than C
    const ids = result.map(r => r.id);
    expect(ids).toContain('1');
    expect(ids).toContain('2');
    expect(ids).not.toContain('3');
  });

  test('should fallback to default summary schema when Groq API encounters error', async () => {
    // summarizeCluster should catch any Groq SDK connection error and return the fallback theme safely
    const result = await summarizeCluster(mockReviews);
    expect(result).toBeDefined();
    expect(result.themeName).toBe('Uncategorized Issues');
    expect(result.representativeQuotes).toBeDefined();
    expect(result.actionIdeas).toBeDefined();
  });
});
