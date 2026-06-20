import { ClusterSummary } from '../reasoning/summarizer';

export interface EmailContent {
  subject: string;
  text: string;
  html: string;
}

/**
 * Compiles a short teaser email summarizing top themes and linking to the full Google Doc report.
 */
export function renderEmailTeaser(
  isoWeek: string,
  themes: ClusterSummary[],
  googleDocUrl: string
): EmailContent {
  const subject = `Groww Weekly Review Pulse — ${isoWeek}`;
  
  // 1. Plain Text version
  let text = `Groww — Weekly Review Pulse (${isoWeek})\n\n`;
  text += `Here is a summary of customer feedback themes from the Play Store:\n\n`;
  
  themes.forEach((t, i) => {
    text += `${i + 1}. ${t.themeName}\n`;
    text += `   ${t.themeDescription}\n\n`;
  });
  
  text += `Read the full detailed report, including verbatim user quotes and actionable ideas, in the Google Doc:\n`;
  text += `${googleDocUrl}\n\n`;
  text += `---\nThis pulse report was automatically generated and delivered.`;

  // 2. HTML version
  let html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 8px; color: #1a202c;">
      <h2 style="color: #2b6cb0; margin-bottom: 5px;">Groww — Weekly Review Pulse</h2>
      <p style="color: #718096; font-size: 14px; margin-top: 0;">Period Focus: <strong>${isoWeek}</strong></p>
      
      <p>Hello Team,</p>
      <p>Here is a snapshot of the top themes identified in the Google Play customer reviews for the Groww app:</p>
      
      <hr style="border: 0; border-top: 1px solid #e2e8f0; margin: 20px 0;" />
      
      <ul style="padding-left: 20px; line-height: 1.6;">
  `;

  themes.forEach((t) => {
    html += `
      <li style="margin-bottom: 15px;">
        <strong style="color: #2d3748; font-size: 16px;">${t.themeName}</strong><br/>
        <span style="color: #4a5568;">${t.themeDescription}</span>
      </li>
    `;
  });

  html += `
      </ul>
      
      <div style="margin: 30px 0; text-align: center;">
        <a href="${googleDocUrl}" style="background-color: #3182ce; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; font-weight: bold; display: inline-block;">
          Read Full Document Report
        </a>
      </div>
      
      <p style="font-size: 13px; color: #a0aec0; border-top: 1px solid #e2e8f0; padding-top: 15px; margin-top: 30px;">
        This email was automatically generated. Verbatim user quotes and full action ideas are archived in the shared Google Doc.
      </p>
    </div>
  `;

  return {
    subject,
    text,
    html
  };
}
