import { Groq } from 'groq-sdk';
import { config } from '../config';
import { PlayStoreReview } from '../ingestion/playStoreScraper';
import { euclideanDistance } from './clusterer';

export interface ClusterSummary {
  themeName: string;
  themeDescription: string;
  representativeQuotes: string[];
  actionIdeas: string[];
}

// Simple rate limiter tracking for Groq API
class GroqRateLimiter {
  private lastRequestTime = 0;
  private minIntervalMs = 3000; // 3 seconds between requests (safely below 30 RPM)
  private tokensUsedInLastMinute = 0;
  private windowStart = Date.now();

  async waitBeforeRequest(estimatedTokens: number): Promise<void> {
    const now = Date.now();
    
    // Reset rolling window for TPM
    if (now - this.windowStart > 60000) {
      this.windowStart = now;
      this.tokensUsedInLastMinute = 0;
    }

    // 1. Request rate check (RPM)
    const timeSinceLast = now - this.lastRequestTime;
    if (timeSinceLast < this.minIntervalMs) {
      const delay = this.minIntervalMs - timeSinceLast;
      console.log(`[GROQ LIMITER] Rate limit safeguard: Sleeping for ${delay}ms...`);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }

    // 2. Token rate check (TPM limit is 12K. We cap at 10K for safety)
    if (this.tokensUsedInLastMinute + estimatedTokens > 10000) {
      const waitTime = 60000 - (Date.now() - this.windowStart);
      console.log(`[GROQ LIMITER] Token limit safety warning (${this.tokensUsedInLastMinute} tokens used). Sleeping for ${waitTime}ms to reset rolling window...`);
      await new Promise((resolve) => setTimeout(resolve, Math.max(waitTime, 1000)));
      this.windowStart = Date.now();
      this.tokensUsedInLastMinute = 0;
    }

    this.lastRequestTime = Date.now();
    this.tokensUsedInLastMinute += estimatedTokens;
  }
}

const rateLimiter = new GroqRateLimiter();

/**
 * Calculates the centroid of vectors at specified indices,
 * then finds and returns reviews sorted by distance from the centroid (closest first).
 */
export function getCentroidClosestReviews(
  reviews: PlayStoreReview[],
  embeddings: number[][],
  indices: number[],
  maxCount: number = 15
): PlayStoreReview[] {
  if (indices.length === 0) return [];
  if (indices.length <= maxCount) {
    return indices.map((idx) => reviews[idx]);
  }

  const dim = embeddings[0].length;
  const centroid = new Array<number>(dim).fill(0);

  // Compute centroid
  for (const idx of indices) {
    const vec = embeddings[idx];
    for (let d = 0; d < dim; d++) {
      centroid[d] += vec[d];
    }
  }
  for (let d = 0; d < dim; d++) {
    centroid[d] /= indices.length;
  }

  // Calculate distance for each review
  const reviewsWithDist = indices.map((idx) => {
    const dist = euclideanDistance(centroid, embeddings[idx]);
    return { review: reviews[idx], dist };
  });

  // Sort by distance ascending (closest to centroid first)
  reviewsWithDist.sort((a, b) => a.dist - b.dist);

  return reviewsWithDist.slice(0, maxCount).map((item) => item.review);
}

/**
 * Uses Groq API (llama-3.3-70b-versatile) to summarize a review cluster into a feedback theme.
 */
export async function summarizeCluster(
  themeReviews: PlayStoreReview[]
): Promise<ClusterSummary> {
  const groq = new Groq({ apiKey: config.groqApiKey });
  
  // Format the reviews list for the LLM
  const reviewsText = themeReviews
    .map((r, i) => `[Review ${i + 1}] Date: ${r.date.toISOString().split('T')[0]}, Rating: ${r.score}★\nText: "${r.content}"`)
    .join('\n\n');

  const prompt = `You are a product feedback analyzer. You are given a cluster of reviews for the Groww financial app.
Analyze the reviews below and identify the core theme.

${reviewsText}

Provide a JSON response containing the synthesized theme details. Follow these constraints:
1. "themeName": a short, descriptive name (3-6 words, e.g. "Peak Market Hour Login Crashes").
2. "themeDescription": a 1-2 sentence description explaining the core problem users are complaining about.
3. "representativeQuotes": extract EXACTLY 2-3 quotes from the reviews provided. They MUST be verbatim substrings of the original review texts. Do not alter spelling, punctuation, or capitalization.
4. "actionIdeas": 2-3 actionable recommendations for the product, engineering, or support teams.

Your response must be valid JSON matching this schema:
{
  "themeName": string,
  "themeDescription": string,
  "representativeQuotes": [string, string],
  "actionIdeas": [string, string]
}`;

  // Estimate tokens: prompt length in chars divided by 4, plus margin
  const estimatedTokens = Math.ceil((prompt.length + reviewsText.length) / 4) + 500;
  
  await rateLimiter.waitBeforeRequest(estimatedTokens);
  
  console.log(`[SUMMARIZER] Summarizing cluster of ${themeReviews.length} reviews using Groq...`);
  
  try {
    const chatCompletion = await groq.chat.completions.create({
      messages: [
        {
          role: 'system',
          content: 'You output only JSON. Never output any introductory or concluding text.'
        },
        {
          role: 'user',
          content: prompt
        }
      ],
      model: 'llama-3.3-70b-versatile',
      temperature: 0.1, // Low temperature for deterministic quote extraction
      response_format: { type: 'json_object' }
    });

    const content = chatCompletion.choices[0]?.message?.content || '{}';
    const parsed = JSON.parse(content) as ClusterSummary;
    
    // Validate schema shape
    if (!parsed.themeName || !parsed.themeDescription || !Array.isArray(parsed.representativeQuotes)) {
      throw new Error('LLM output does not match expected JSON schema');
    }
    
    return parsed;
  } catch (err: any) {
    console.error('[SUMMARIZER ERROR] Failed to summarize cluster:', err.message || err);
    return {
      themeName: 'Uncategorized Issues',
      themeDescription: 'General reviews that could not be summarized due to an API error.',
      representativeQuotes: themeReviews.slice(0, 2).map((r) => r.content),
      actionIdeas: ['Investigate system logs for errors in reasoning modules.']
    };
  }
}
