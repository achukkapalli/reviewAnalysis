import { loadESM } from '../utils/esmLoader';

export interface PlayStoreReview {
  id: string;
  userName: string;
  userImage: string;
  content: string;
  score: number;
  thumbsUp: number;
  version: string;
  date: Date;
}

export interface FetchOptions {
  appId: string;
  lookbackWeeks: number;
  targetDate?: Date; // Reference date for the lookback window (defaults to now)
}

/**
 * Fetches Google Play reviews for a given app ID within a rolling week lookback window.
 * Uses pagination to retrieve historical reviews and stops once reviews go past the lookback window.
 */
export async function fetchReviews(options: FetchOptions): Promise<PlayStoreReview[]> {
  const gplayModule = await loadESM('google-play-scraper');
  const gplay = gplayModule.default || gplayModule;
  const appId = options.appId;
  const lookbackWeeks = options.lookbackWeeks;
  const refDate = options.targetDate || new Date();
  
  // Calculate threshold date: refDate - lookbackWeeks
  const thresholdTime = refDate.getTime() - lookbackWeeks * 7 * 24 * 60 * 60 * 1000;
  const thresholdDate = new Date(thresholdTime);
  
  console.log(`[SCRAPER] Fetching reviews for ${appId}`);
  console.log(`[SCRAPER] Lookback: ${lookbackWeeks} weeks (from ${refDate.toISOString()} back to ${thresholdDate.toISOString()})`);
  
  const allReviews: PlayStoreReview[] = [];
  let nextPageToken: string | undefined = undefined;
  let keepFetching = true;
  let pageCount = 0;
  const maxPages = 50; // Safety cap to prevent infinite loops / API exhaustion
  
  while (keepFetching && pageCount < maxPages) {
    pageCount++;
    try {
      const response: any = await gplay.reviews({
        appId: appId,
        sort: gplay.sort.NEWEST,
        paginate: true,
        nextPaginationToken: nextPageToken,
        num: 150 // Fetch large batches to minimize page transitions
      });
      
      const rawReviews = response.data || [];
      nextPageToken = response.nextPaginationToken;
      
      if (rawReviews.length === 0) {
        console.log('[SCRAPER] No more reviews returned by Play Store API.');
        break;
      }
      
      console.log(`[SCRAPER] Page ${pageCount}: Fetched ${rawReviews.length} reviews.`);
      
      for (const raw of rawReviews) {
        const reviewDate = raw.date ? new Date(raw.date) : new Date();
        
        // If we hit a review older than the threshold, we can stop since reviews are sorted newest-first
        if (reviewDate < thresholdDate) {
          console.log(`[SCRAPER] Reached review from ${reviewDate.toISOString()} which is older than threshold. Stopping ingestion.`);
          keepFetching = false;
          break;
        }
        
        allReviews.push({
          id: raw.id || '',
          userName: raw.userName || 'Anonymous',
          userImage: raw.userImage || '',
          content: raw.text || raw.content || '',
          score: raw.score || 0,
          thumbsUp: raw.thumbsUp || 0,
          version: raw.version || 'Unknown',
          date: reviewDate
        });
      }
      
      // If there's no token for the next page, stop
      if (!nextPageToken) {
        console.log('[SCRAPER] No pagination token remaining.');
        break;
      }
      
    } catch (err: any) {
      console.error(`[SCRAPER ERROR] Failed to fetch review page ${pageCount}:`, err.message || err);
      break;
    }
  }
  
  console.log(`[SCRAPER] Ingestion complete. Collected a total of ${allReviews.length} reviews.`);
  return allReviews;
}
