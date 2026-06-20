import * as dotenv from 'dotenv';
import * as path from 'path';

// Load environment variables from .env file
dotenv.config();

export interface Config {
  groqApiKey: string;
  growwDocId: string;
  stakeholderEmails: string[];
  environment: 'development' | 'production';
  lookbackWeeks: number;
  runLogPath: string;
  mcpServerUrl?: string;
}

const getEnvEmails = (val?: string): string[] => {
  if (!val) return [];
  return val.split(',').map((email) => email.trim()).filter((email) => email.length > 0);
};

export const config: Config = {
  groqApiKey: process.env.GROQ_API_KEY || '',
  growwDocId: process.env.GROWW_DOC_ID || '',
  stakeholderEmails: getEnvEmails(process.env.STAKEHOLDER_EMAILS),
  environment: (process.env.NODE_ENV || 'development') as 'development' | 'production',
  lookbackWeeks: parseInt(process.env.LOOKBACK_WEEKS || '10', 10),
  runLogPath: process.env.RUN_LOG_PATH || path.join(process.cwd(), 'data', 'run_log.json'),
  mcpServerUrl: process.env.MCP_SERVER_URL || '',
};

// Validate critical configurations
export function validateConfig(): void {
  const missingVars: string[] = [];

  if (!config.groqApiKey) {
    missingVars.push('GROQ_API_KEY');
  }

  if (missingVars.length > 0) {
    console.error(`[CONFIG ERROR] Missing required environment variables: ${missingVars.join(', ')}`);
    console.error('Please configure them in your .env file or environment.');
    process.exit(1);
  }

  if (!config.growwDocId) {
    console.warn('[CONFIG WARNING] GROWW_DOC_ID is not configured. The system will look for or try to create a Google Doc.');
  }
}
