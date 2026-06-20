import express, { Request, Response } from 'express';
import * as path from 'path';
import * as fs from 'fs';
import { config } from './config';
import { runPulsePipeline } from './index';
import { initializeMCP, closeMCP } from './delivery/mcpManager';
import { renderEmailTeaser } from './rendering/emailRenderer';
import { deliverTeaserEmail } from './delivery/gmailDelivery';

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(process.cwd(), 'public')));

/**
 * GET /api/reports
 * Lists all reports recorded in run_log.json combined with report summaries from data/reports/
 */
app.get('/api/reports', (req: Request, res: Response) => {
  try {
    const logPath = config.runLogPath;
    let runLog: Record<string, any> = {};
    if (fs.existsSync(logPath)) {
      runLog = JSON.parse(fs.readFileSync(logPath, 'utf8'));
    }

    const reportsDir = path.join(process.cwd(), 'data', 'reports');
    const reportsList: any[] = [];

    // First check reports directory for files
    if (fs.existsSync(reportsDir)) {
      const files = fs.readdirSync(reportsDir);
      for (const file of files) {
        if (file.startsWith('groww_') && file.endsWith('.json')) {
          const week = file.substring(6, file.length - 5); // Extract YYYY-Www
          const reportPath = path.join(reportsDir, file);
          try {
            const reportData = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
            reportsList.push({
              week,
              timestamp: reportData.timestamp || new Date().toISOString(),
              docUrl: reportData.docUrl || '',
              gmailId: reportData.gmailId || '',
              status: reportData.status || 'SUCCESS'
            });
          } catch (e) {
            console.error(`Error parsing report file ${file}:`, e);
          }
        }
      }
    }

    // Blend with run_log entries that might not be in reports folder (just in case)
    Object.entries(runLog).forEach(([key, val]: [string, any]) => {
      const week = key.replace('groww:', '');
      const exists = reportsList.some(r => r.week === week);
      if (!exists && val.status === 'SUCCESS') {
        reportsList.push({
          week,
          timestamp: val.timestamp,
          docUrl: val.docUrl,
          gmailId: val.gmailId,
          status: val.status
        });
      }
    });

    // Sort by week descending
    reportsList.sort((a, b) => b.week.localeCompare(a.week));

    res.json(reportsList);
  } catch (err: any) {
    console.error('Error fetching reports list:', err);
    res.status(500).json({ error: err.message || 'Internal server error' });
  }
});

/**
 * GET /api/reports/:week
 * Returns details (themes, description, quotes, actions) of a specific week
 */
app.get('/api/reports/:week', (req: Request, res: Response) => {
  const { week } = req.params;
  try {
    const reportPath = path.join(process.cwd(), 'data', 'reports', `groww_${week}.json`);
    if (fs.existsSync(reportPath)) {
      const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
      return res.json(report);
    }

    // If report is in run log but has no summary JSON, construct a basic outline
    const logPath = config.runLogPath;
    let runLog: Record<string, any> = {};
    if (fs.existsSync(logPath)) {
      runLog = JSON.parse(fs.readFileSync(logPath, 'utf8'));
    }

    const logEntry = runLog[`groww:${week}`];
    if (logEntry) {
      return res.json({
        week,
        timestamp: logEntry.timestamp,
        docUrl: logEntry.docUrl,
        gmailId: logEntry.gmailId,
        status: logEntry.status,
        themes: []
      });
    }

    res.status(404).json({ error: `Report for week ${week} not found` });
  } catch (err: any) {
    console.error(`Error loading report for ${week}:`, err);
    res.status(500).json({ error: err.message || 'Internal server error' });
  }
});

/**
 * GET /api/stakeholders
 * Returns the current list of stakeholder emails
 */
app.get('/api/stakeholders', (req: Request, res: Response) => {
  res.json({ emails: config.stakeholderEmails });
});

/**
 * POST /api/stakeholders
 * Updates stakeholders list, updates .env file, and drafts email for selected week
 */
app.post('/api/stakeholders', async (req: Request, res: Response) => {
  const { emails, activeWeek } = req.body;

  if (!Array.isArray(emails)) {
    return res.status(400).json({ error: 'emails parameter must be an array of strings' });
  }

  // Filter and sanitize emails
  const cleanEmails = emails
    .map(e => e.trim())
    .filter(e => e.length > 0 && e.includes('@'));

  try {
    // 1. Update .env file programmatically
    const envPath = path.join(process.cwd(), '.env');
    let envContent = '';
    if (fs.existsSync(envPath)) {
      envContent = fs.readFileSync(envPath, 'utf8');
    }

    const emailsStr = cleanEmails.join(',');
    const emailsLine = `STAKEHOLDER_EMAILS=${emailsStr}`;

    if (envContent.includes('STAKEHOLDER_EMAILS=')) {
      // Replace the existing line
      envContent = envContent.replace(/STAKEHOLDER_EMAILS=.*/, emailsLine);
    } else {
      // Append to env file
      envContent += `\n${emailsLine}`;
    }
    fs.writeFileSync(envPath, envContent, 'utf8');

    // 2. Update runtime config memory
    config.stakeholderEmails = cleanEmails;
    console.log(`[SERVER] Updated stakeholder list to: ${cleanEmails.join(', ')}`);

    let draftId = '';
    let isDraft = false;

    // 3. Draft teaser email if an active week is selected and report summary exists
    if (activeWeek) {
      const reportsDir = path.join(process.cwd(), 'data', 'reports');
      const reportPath = path.join(reportsDir, `groww_${activeWeek}.json`);

      if (fs.existsSync(reportPath)) {
        const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
        const themes = report.themes || [];
        const docUrl = report.docUrl || 'https://docs.google.com/document/d/mock-doc-id/edit';

        if (themes.length > 0) {
          console.log(`[SERVER] Generating new Gmail draft email for ${activeWeek} to new stakeholder list...`);
          
          // Connect to Gmail MCP client
          await initializeMCP();

          const emailContent = renderEmailTeaser(activeWeek, themes, docUrl);
          
          // Deliver email (non-prod will create a draft)
          const delivery = await deliverTeaserEmail(
            emailContent.subject,
            emailContent.text,
            emailContent.html
          );

          draftId = delivery.messageId;
          isDraft = delivery.isDraft;

          // Disconnect MCP
          await closeMCP();

          // Update report summary file with new draft ID if successful
          report.gmailId = draftId;
          fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8');

          // Update run_log.json as well
          const logPath = config.runLogPath;
          if (fs.existsSync(logPath)) {
            const runLog = JSON.parse(fs.readFileSync(logPath, 'utf8'));
            const key = `groww:${activeWeek}`;
            if (runLog[key]) {
              runLog[key].gmailId = draftId;
              fs.writeFileSync(logPath, JSON.stringify(runLog, null, 2), 'utf8');
            }
          }

          console.log(`[SERVER] Email draft created successfully with ID: ${draftId}`);
        } else {
          console.warn(`[SERVER] Report for ${activeWeek} has no themes to draft email.`);
        }
      } else {
        console.warn(`[SERVER] No report details found for ${activeWeek} at ${reportPath}`);
      }
    }

    res.json({
      success: true,
      emails: config.stakeholderEmails,
      draftId,
      isDraft
    });
  } catch (err: any) {
    console.error('[SERVER ERROR] Error updating stakeholders or drafting email:', err);
    await closeMCP();
    res.status(500).json({ error: err.message || 'Failed to update stakeholders and draft email' });
  }
});

/**
 * POST /api/run-pulse
 * Triggers review analysis pipeline for specific week
 */
app.post('/api/run-pulse', async (req: Request, res: Response) => {
  const { week, force } = req.body;
  console.log(`[SERVER] Request to run pulse for week: ${week || 'current'}, force: ${!!force}`);

  try {
    const result = await runPulsePipeline({
      week,
      force,
      dryRun: false // Run actual delivery (depends on environment)
    });
    res.json({ success: true, result });
  } catch (err: any) {
    console.error('[SERVER ERROR] Pipeline run failed:', err);
    res.status(500).json({ error: err.message || 'Pipeline execution failed' });
  }
});

// Start the server
app.listen(PORT, () => {
  console.log('==================================================');
  console.log(`📡 Server running on http://localhost:${PORT}`);
  console.log('==================================================');
});
