import { callMCPTool, getGmailClient } from './mcpManager';
import { config } from '../config';

export interface GmailDeliveryResult {
  messageId: string;
  isDraft: boolean;
}

/**
 * Delivers the teaser email to configured stakeholders via the Gmail MCP server.
 * Creates a draft in development/staging and sends directly in production.
 */
export async function deliverTeaserEmail(
  subject: string,
  bodyText: string,
  bodyHtml: string
): Promise<GmailDeliveryResult> {
  const client = getGmailClient();
  const recipients = config.stakeholderEmails;
  const isProd = config.environment === 'production';
  
  if (recipients.length === 0) {
    console.warn('[GMAIL DELIVERY] No stakeholder emails configured (STAKEHOLDER_EMAILS in env). Skipping email delivery.');
    return { messageId: 'skipped-no-recipients', isDraft: false };
  }

  const toField = recipients.join(', ');

  if (isProd) {
    console.log(`[GMAIL DELIVERY] Production Mode: Sending email to: [${toField}]`);
    let messageId = 'mock-prod-message-id';
    let isDraftResult = false;
    
    if (client) {
      try {
        // Check if the client supports sending or only draft creation
        let supportsSending = false;
        try {
          const toolsResponse = await client.listTools();
          const toolNames = toolsResponse.tools.map((t: any) => t.name);
          supportsSending = toolNames.some((name: string) => 
            ['send_message', 'send_email', 'gmail_send_message'].includes(name)
          );
        } catch {
          supportsSending = true; // Fallback to try sending
        }

        if (supportsSending) {
          const result = await callMCPTool(
            client,
            ['send_message', 'send_email', 'gmail_send_message'],
            {
              to: recipients, // Some tools take array of strings
              cc: [],
              bcc: [],
              subject: subject,
              body: bodyText,
              htmlBody: bodyHtml
            }
          );
          messageId = result.messageId || result.id || JSON.stringify(result);
          console.log(`[GMAIL DELIVERY] Email successfully sent. Message ID: ${messageId}`);
        } else {
          console.warn('[GMAIL DELIVERY WARNING] Direct email sending tool is not supported by the MCP server. Falling back to creating a draft instead.');
          const result = await callMCPTool(
            client,
            ['create_draft', 'create_email_draft', 'gmail_create_draft'],
            {
              draft: {
                message: {
                  to: recipients,
                  subject: subject,
                  body: bodyText,
                  htmlBody: bodyHtml
                }
              }
            }
          );
          messageId = result.draftId || result.id || JSON.stringify(result);
          isDraftResult = true;
          console.log(`[GMAIL DELIVERY] Email draft created as fallback. Draft ID: ${messageId}`);
        }
      } catch (err: any) {
        console.error('[GMAIL DELIVERY ERROR] Failed to deliver email via Gmail MCP:', err.message || err);
        throw err;
      }
    } else {
      console.log(`[GMAIL DELIVERY MOCK] Production: Mock sent email to [${toField}]`);
    }
    
    return { messageId, isDraft: isDraftResult };
  } else {
    console.log(`[GMAIL DELIVERY] Non-production Mode: Creating draft for: [${toField}]`);
    let draftId = 'mock-dev-draft-id';

    if (client) {
      try {
        const result = await callMCPTool(
          client,
          ['create_draft', 'create_email_draft', 'gmail_create_draft'],
          {
            draft: {
              message: {
                to: recipients,
                subject: subject,
                body: bodyText,
                htmlBody: bodyHtml
              }
            }
          }
        );
        draftId = result.draftId || result.id || JSON.stringify(result);
        console.log(`[GMAIL DELIVERY] Email draft successfully created. Draft ID: ${draftId}`);
      } catch (err: any) {
        console.error('[GMAIL DELIVERY ERROR] Failed to create email draft via Gmail MCP:', err.message || err);
        throw err;
      }
    } else {
      console.log(`[GMAIL DELIVERY MOCK] Non-production: Mock created email draft for [${toField}]`);
    }

    return { messageId: draftId, isDraft: true };
  }
}
