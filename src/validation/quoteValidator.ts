import { PlayStoreReview } from '../ingestion/playStoreScraper';

export interface ValidationResult {
  validQuotes: string[];
  warnings: string[];
}

/**
 * Validates that quotes returned by the LLM exist verbatim in the source reviews list.
 * 
 * If a quote doesn't match exactly, the validator attempts:
 * 1. Case-insensitive and punctuation-insensitive matching. If it finds a match this way,
 *    it replaces the LLM's quote with the exact verbatim string from the original review text.
 * 2. If no match can be recovered, the quote is discarded and a warning is logged.
 */
export function validateQuotes(
  llmQuotes: string[],
  sourceReviews: PlayStoreReview[]
): ValidationResult {
  const validQuotes: string[] = [];
  const warnings: string[] = [];
  
  // Helper to normalize strings for comparison (strip non-alphanumeric and lowercase)
  const normalize = (str: string): string => {
    return str.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
  };

  for (const quote of llmQuotes) {
    if (!quote || quote.trim().length === 0) continue;

    const trimmedQuote = quote.trim();
    let exactMatchFound = false;
    let fallbackMatch: string | null = null;

    for (const r of sourceReviews) {
      // 1. Direct exact verbatim match
      if (r.content.includes(trimmedQuote)) {
        validQuotes.push(trimmedQuote);
        exactMatchFound = true;
        break;
      }
      
      // 2. Insensitive match search (lowercase & clean spaces/symbols)
      const normalizedReview = normalize(r.content);
      const normalizedQuote = normalize(trimmedQuote);
      
      if (normalizedQuote.length > 5 && normalizedReview.includes(normalizedQuote)) {
        // Find the index of the normalized quote inside the review
        // Since normalization removes characters, we can search for the original words in the raw content.
        // As a simpler and safer approach, we can extract the sentence or context from the review.
        // To be safe, we will just use the entire raw review text as the verbatim quote!
        fallbackMatch = r.content;
      }
    }

    if (exactMatchFound) {
      continue;
    }

    if (fallbackMatch) {
      console.warn(`[VALIDATOR WARNING] Quote did not match exactly: "${trimmedQuote}". Recovered verbatim original review content: "${fallbackMatch.substring(0, 50)}..."`);
      validQuotes.push(fallbackMatch);
      warnings.push(`Quote modified to match verbatim content: "${trimmedQuote}" -> "${fallbackMatch}"`);
    } else {
      console.warn(`[VALIDATOR WARNING] Quote could not be validated or found in reviews list: "${trimmedQuote}". Discarding.`);
      warnings.push(`Quote discarded (not found in source texts): "${trimmedQuote}"`);
    }
  }

  // If we ended up with zero quotes, pick the first review content as a fallback
  if (validQuotes.length === 0 && sourceReviews.length > 0) {
    const fallbackText = sourceReviews[0].content;
    validQuotes.push(fallbackText);
    warnings.push(`No quotes validated. Substituted with top representative review: "${fallbackText}"`);
  }

  return {
    validQuotes,
    warnings
  };
}
