import * as fs from 'fs';
import * as path from 'path';
import { config, validateConfig } from './config';
import { fetchReviews, PlayStoreReview } from './ingestion/playStoreScraper';
import { scrubReviewText } from './security/piiScrubber';
import { generateEmbeddings } from './reasoning/embedder';
import { runClustering } from './reasoning/clusterer';
import { getCentroidClosestReviews, summarizeCluster, ClusterSummary } from './reasoning/summarizer';
import { validateQuotes } from './validation/quoteValidator';
import { renderPlainTextReport } from './rendering/docsRenderer';
import { renderEmailTeaser } from './rendering/emailRenderer';
import { initializeMCP, closeMCP } from './delivery/mcpManager';
import { deliverToGoogleDoc } from './delivery/docsDelivery';
import { deliverTeaserEmail } from './delivery/gmailDelivery';

// Target App ID for Groww
const GROWW_APP_ID = 'com.nextbillion.groww';

interface RunEntry {
  timestamp: string;
  status: 'SUCCESS' | 'FAILED';
  docUrl: string;
  gmailId: string;
}

type RunLog = Record<string, RunEntry>; // Key format: "product:iso_week"

/**
 * Helper to calculate current ISO week (YYYY-Www)
 */
function getCurrentISOWeek(date: Date = new Date()): string {
  const target = new Date(date.valueOf());
  const dayNr = (date.getDay() + 6) % 7;
  target.setDate(target.getDate() - dayNr + 3);
  const firstThursday = target.valueOf();
  target.setMonth(0, 1);
  if (target.getDay() !== 4) {
    target.setMonth(0, 1 + ((4 - target.getDay() + 7) % 7));
  }
  const weekNum = 1 + Math.ceil((firstThursday - target.valueOf()) / 604800000);
  return `${target.getFullYear()}-W${String(weekNum).padStart(2, '0')}`;
}

/**
 * Calculates start and end Date bounds for a specific ISO week string (e.g. "2026-W23")
 */
function getISOWeekBounds(isoWeekStr: string): { start: Date; end: Date } {
  const parts = isoWeekStr.split('-W');
  if (parts.length !== 2) {
    throw new Error(`Invalid ISO Week format: ${isoWeekStr}. Expected YYYY-Www`);
  }
  const year = parseInt(parts[0], 10);
  const week = parseInt(parts[1], 10);

  // Jan 4th is always in ISO Week 1
  const simple = new Date(year, 0, 4);
  const dayOfWeek = simple.getDay() || 7;
  const firstMonday = new Date(simple.getTime() - (dayOfWeek - 1) * 24 * 60 * 60 * 1000);
  const start = new Date(firstMonday.getTime() + (week - 1) * 7 * 24 * 60 * 60 * 1000);
  const end = new Date(start.getTime() + 7 * 24 * 60 * 60 * 1000 - 1);
  return { start, end };
}

/**
 * Reads local run log to ensure idempotency.
 */
function readRunLog(): RunLog {
  const logPath = config.runLogPath;
  if (!fs.existsSync(logPath)) {
    const dir = path.dirname(logPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(logPath, JSON.stringify({}));
    return {};
  }
  try {
    return JSON.parse(fs.readFileSync(logPath, 'utf8'));
  } catch (err) {
    console.warn('[ORCHESTRATOR] Run log parse error, returning empty state.');
    return {};
  }
}

/**
 * Appends a successful run record to the run log.
 */
function writeRunLog(runKey: string, entry: RunEntry): void {
  const logs = readRunLog();
  logs[runKey] = entry;
  fs.writeFileSync(config.runLogPath, JSON.stringify(logs, null, 2));
}

/**
 * Parses and processes arguments passed to the CLI.
 */
function parseArgs() {
  const args = process.argv.slice(2);
  const parsed: Record<string, string | boolean> = {};
  
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--dry-run') {
      parsed.dryRun = true;
    } else if (arg === '--force') {
      parsed.force = true;
    } else if (arg === '--week') {
      parsed.week = args[i + 1];
      i++;
    } else if (arg === '--env') {
      parsed.env = args[i + 1];
      i++;
    }
  }
  return parsed;
}

export interface PipelineOptions {
  week?: string;
  dryRun?: boolean;
  force?: boolean;
  env?: 'development' | 'production';
}

/**
 * Main pipeline runner that can be imported and run programmatically or via CLI
 */
export async function runPulsePipeline(options: PipelineOptions = {}) {
  // Override config if passed
  if (options.env) {
    config.environment = options.env;
  }
  if (options.dryRun) {
    console.log('[ORCHESTRATOR] Dry-run enabled. Writes to Google Doc/Gmail will be mocked.');
    process.env.MOCK_MCP = 'true';
  } else {
    // Reset mock MCP env var if not explicitly dryRun
    delete process.env.MOCK_MCP;
  }

  // Validate critical env variables (API key etc.)
  validateConfig();

  // Determine Target ISO Week
  const targetWeek = options.week || getCurrentISOWeek();
  const runKey = `groww:${targetWeek}`;
  console.log(`[ORCHESTRATOR] Targeted ISO Week: ${targetWeek}`);
  console.log(`[ORCHESTRATOR] Execution Mode: ${config.environment.toUpperCase()}`);

  // 2. Local State Idempotency Check (Step 1)
  const logs = readRunLog();
  if (logs[runKey] && logs[runKey].status === 'SUCCESS' && !options.force) {
    console.log(`\n[IDEMPOTENCY SKIP] A successful run for ${targetWeek} already exists in local logs.`);
    console.log(`Ran at: ${logs[runKey].timestamp}`);
    console.log(`Google Doc Section: ${logs[runKey].docUrl}`);
    
    // Load existing local report if it exists
    const reportsDir = path.join(process.cwd(), 'data', 'reports');
    const reportPath = path.join(reportsDir, `groww_${targetWeek}.json`);
    let themes: ClusterSummary[] = [];
    if (fs.existsSync(reportPath)) {
      try {
        const stored = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
        themes = stored.themes || [];
      } catch (e) {
        console.warn('[ORCHESTRATOR] Failed to parse local report details JSON.');
      }
    }
    
    return {
      skipped: true,
      docUrl: logs[runKey].docUrl,
      gmailId: logs[runKey].gmailId,
      timestamp: logs[runKey].timestamp,
      themes
    };
  }

  try {
    // Determine review dates boundaries (rolling lookback up to end of targeted week)
    const weekBounds = getISOWeekBounds(targetWeek);
    const refDate = weekBounds.end;

    // 3. Ingestion: Fetch reviews from Play Store
    let rawReviews = await fetchReviews({
      appId: GROWW_APP_ID,
      lookbackWeeks: config.lookbackWeeks,
      targetDate: refDate
    });

    const totalIngested = rawReviews.length;
    // Filter reviews with less than 8 words to ensure profound context on action items
    rawReviews = rawReviews.filter(r => {
      const words = r.content.trim().split(/\s+/).filter(w => w.length > 0);
      return words.length >= 8;
    });
    console.log(`[ORCHESTRATOR] Filtered out ${totalIngested - rawReviews.length} reviews containing less than 8 words. ${rawReviews.length} reviews remaining for analysis.`);

    if (rawReviews.length === 0) {
      console.log('[ORCHESTRATOR] No reviews with 8 or more words found for the lookback window. Skipping analysis.');
      return {
        skipped: true,
        reason: 'No reviews found matching requirements.'
      };
    }

    // 4. Security: Scrub PII & Neutralize Prompt Injection
    console.log('[ORCHESTRATOR] Sanitizing and scrubbing PII from reviews...');
    const scrubbedReviews: PlayStoreReview[] = [];
    let piiCounts = 0;
    
    for (const r of rawReviews) {
      const scrubResult = scrubReviewText(r.content);
      if (scrubResult.piiRemoved) piiCounts++;
      
      scrubbedReviews.push({
        ...r,
        content: scrubResult.scrubbedText
      });
    }
    console.log(`[ORCHESTRATOR] Scrubbing completed. Redacted PII in ${piiCounts} reviews.`);

    // 5. Embeddings: Generate local vector embeddings
    const texts = scrubbedReviews.map((r) => r.content);
    const embeddings = await generateEmbeddings(texts);

    // 6. Clustering: DBSCAN on embeddings
    const clusterAssignments = runClustering(embeddings, { eps: 0.7 });

    // Group reviews by cluster index
    const clusters: Record<number, number[]> = {};
    clusterAssignments.forEach((cId, itemIdx) => {
      if (!clusters[cId]) {
        clusters[cId] = [];
      }
      clusters[cId].push(itemIdx);
    });

    // 7. Summarization (LLM Reasoning with Groq)
    const numClusters = Object.keys(clusters).filter(k => k !== '-1').length;
    console.log(`[ORCHESTRATOR] Found ${numClusters} feedback clusters (excluding noise).`);

    const finalThemes: ClusterSummary[] = [];

    for (const key of Object.keys(clusters)) {
      const clusterId = parseInt(key, 10);
      if (clusterId === -1) continue; // Skip noise points

      const indices = clusters[clusterId];
      console.log(`\n[ORCHESTRATOR] Processing Cluster ${clusterId} (${indices.length} reviews)...`);
      
      // Select the reviews closest to the cluster center (max 15 reviews)
      const representativeReviews = getCentroidClosestReviews(scrubbedReviews, embeddings, indices, 15);
      
      // Run LLM synthesis
      const rawSummary = await summarizeCluster(representativeReviews);
      
      // Validate Quotes programmatically
      console.log('[ORCHESTRATOR] Validating LLM quotes verbatim...');
      const fullClusterReviews = indices.map((idx) => scrubbedReviews[idx]);
      const validation = validateQuotes(rawSummary.representativeQuotes, fullClusterReviews);
      
      finalThemes.push({
        themeName: rawSummary.themeName,
        themeDescription: rawSummary.themeDescription,
        representativeQuotes: validation.validQuotes,
        actionIdeas: rawSummary.actionIdeas
      });
    }

    // 8. Workspace Delivery via MCP
    console.log('\n[ORCHESTRATOR] Preparing delivery via MCP...');
    
    // Connect to MCP Google Workspace servers
    await initializeMCP();

    // Render Docs plain-text report
    const plainTextReport = renderPlainTextReport(targetWeek, config.lookbackWeeks, finalThemes);

    // Deliver to Google Doc
    const docId = config.growwDocId || 'mock-doc-id';
    const docDelivery = await deliverToGoogleDoc(docId, targetWeek, plainTextReport);

    let gmailId = 'skipped';
    if (docDelivery.skipped) {
      console.log('[ORCHESTRATOR] Google Doc report write skipped (duplicate heading anchor found). Skipping Gmail report alert.');
    } else {
      // Render Email Teaser
      const emailContent = renderEmailTeaser(targetWeek, finalThemes, docDelivery.sectionUrl);

      // Deliver Gmail draft or send email
      const emailDelivery = await deliverTeaserEmail(
        emailContent.subject,
        emailContent.text,
        emailContent.html
      );
      gmailId = emailDelivery.messageId;
    }

    // Disconnect MCP servers
    await closeMCP();

    // 9. Log Completion in Run DB
    const finalStatus: RunEntry = {
      timestamp: new Date().toISOString(),
      status: 'SUCCESS',
      docUrl: docDelivery.sectionUrl,
      gmailId: gmailId
    };
    writeRunLog(runKey, finalStatus);

    // 10. Save detailed report JSON to data/reports
    const reportsDir = path.join(process.cwd(), 'data', 'reports');
    if (!fs.existsSync(reportsDir)) {
      fs.mkdirSync(reportsDir, { recursive: true });
    }
    const reportPath = path.join(reportsDir, `groww_${targetWeek}.json`);
    fs.writeFileSync(reportPath, JSON.stringify({
      week: targetWeek,
      timestamp: finalStatus.timestamp,
      docUrl: finalStatus.docUrl,
      gmailId: finalStatus.gmailId,
      status: finalStatus.status,
      themes: finalThemes
    }, null, 2));

    console.log('\n==================================================');
    console.log('✅ Weekly Product Review Pulse completed successfully!');
    console.log(`Local log updated: ${runKey}`);
    console.log(`Google Doc Link: ${docDelivery.sectionUrl}`);
    console.log(`Gmail reference ID: ${gmailId}`);
    console.log('==================================================');

    return {
      skipped: false,
      docUrl: docDelivery.sectionUrl,
      gmailId: gmailId,
      timestamp: finalStatus.timestamp,
      themes: finalThemes
    };

  } catch (err: any) {
    console.error('\n❌ Execution failed during run sequencer:', err.stack || err);
    await closeMCP();
    throw err;
  }
}

/**
 * CLI sequencer entry point
 */
async function main() {
  console.log('==================================================');
  console.log('🚀 Starting Weekly Product Review Pulse (Groww) CLI');
  console.log('==================================================');

  const cliArgs = parseArgs();
  
  try {
    const result = await runPulsePipeline({
      week: cliArgs.week as string,
      dryRun: cliArgs.dryRun as boolean,
      force: cliArgs.force as boolean,
      env: cliArgs.env as any
    });
    
    if (result.skipped) {
      console.log('[CLI] Execution skipped or completed with defaults.');
      process.exit(0);
    }
  } catch (err) {
    console.error('[CLI] Run failed:', err);
    process.exit(1);
  }
}

// Execute orchestrator if run directly
if (require.main === module || (process.mainModule && process.mainModule.filename === __filename)) {
  main();
}
