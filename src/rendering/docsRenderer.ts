import { ClusterSummary } from '../reasoning/summarizer';

/**
 * Renders the weekly report as a clean plain-text string.
 * This plain text will be appended to the Groww Google Doc.
 */
export function renderPlainTextReport(
  isoWeek: string,
  lookbackWeeks: number,
  themes: ClusterSummary[]
): string {
  const dateStr = new Date().toISOString().split('T')[0];
  
  let text = `\n\n================================================================================\n`;
  text += `Groww — Weekly Review Pulse (${isoWeek})\n`;
  text += `Generated on: ${dateStr} | Period: Last ${lookbackWeeks} weeks (rolling window)\n`;
  text += `================================================================================\n\n`;

  text += `📋 TOP FEEDBACK THEMES:\n\n`;
  
  if (themes.length === 0) {
    text += `No prominent feedback clusters were identified for this period.\n\n`;
  } else {
    themes.forEach((theme, idx) => {
      text += `${idx + 1}. ${theme.themeName}\n`;
      text += `Description: ${theme.themeDescription}\n\n`;
      
      text += `* Real User Quotes:\n`;
      theme.representativeQuotes.forEach((quote) => {
        text += `  - "${quote.replace(/\n/g, ' ')}"\n`;
      });
      text += `\n`;
      
      text += `* Action Ideas:\n`;
      theme.actionIdeas.forEach((idea) => {
        text += `  - ${idea}\n`;
      });
      text += `\n`;
    });
  }
  
  text += `--------------------------------------------------------------------------------`; // Divider between runs
  return text;
}
