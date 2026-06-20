import { callMCPTool, getGDocsClient } from './mcpManager';
import { config } from '../config';

export interface DocsDeliveryResult {
  skipped: boolean;
  sectionUrl: string;
}

/**
 * Delivers the weekly plain-text report to the canonical Google Doc for Groww.
 * Checks for existing sections to ensure idempotency.
 */
export async function deliverToGoogleDoc(
  docId: string,
  isoWeek: string,
  reportText: string
): Promise<DocsDeliveryResult> {
  const client = getGDocsClient();
  const targetHeader = `Groww — Weekly Review Pulse (${isoWeek})`;
  
  console.log(`[DOCS DELIVERY] Checking for existing section: "${targetHeader}" in document: ${docId || 'MOCK_ID'}`);

  let documentContent = '';
  
  if (client) {
    try {
      // 1. Read the document to check for idempotency
      const readResult = await callMCPTool(client, ['read_document', 'get_document', 'view_document'], {
        documentId: docId
      });
      
      // Handle different return formats from Google Docs MCP servers
      if (readResult && Array.isArray(readResult)) {
        documentContent = readResult.map(c => c.text || '').join('\n');
      } else if (typeof readResult === 'string') {
        documentContent = readResult;
      } else if (readResult && typeof readResult === 'object') {
        documentContent = readResult.body?.content || readResult.text || JSON.stringify(readResult);
      }
    } catch (err: any) {
      console.warn(`[DOCS DELIVERY WARNING] Could not read document: ${err.message || err}. Proceeding with assumption that section does not exist.`);
    }
  }

  // 2. Perform idempotency check
  if (documentContent.includes(targetHeader)) {
    console.log(`[DOCS DELIVERY] Found duplicate section: "${targetHeader}" already exists in the document.`);
    return {
      skipped: true,
      sectionUrl: `https://docs.google.com/document/d/${docId}/edit`
    };
  }

  console.log('[DOCS DELIVERY] Section not found. Appending report...');

  let sectionUrl = `https://docs.google.com/document/d/${docId}/edit`;
  
  if (client) {
    try {
      // 3. Append the plain-text section.
      // We list multiple possibilities in order of preference.
      // Note: the MCP server's append_markdown and append_text tools both write plain text.
      const appendResult = await callMCPTool(
        client, 
        ['append_markdown', 'append_text', 'write_document', 'update_document'], 
        {
          documentId: docId,
          text: reportText,
          markdown: reportText // Pass to both to support whichever parameter name the server expects
        }
      );
      
      // If the tool returns a heading ID or specific heading link, parse it
      if (appendResult && appendResult.headingId) {
        sectionUrl = `https://docs.google.com/document/d/${docId}/edit#heading=${appendResult.headingId}`;
      } else if (appendResult && appendResult.sectionUrl) {
        sectionUrl = appendResult.sectionUrl;
      }
      
      console.log(`[DOCS DELIVERY] Successfully appended section. URL: ${sectionUrl}`);
    } catch (err: any) {
      console.error('[DOCS DELIVERY ERROR] Failed to append report to Google Doc:', err.message || err);
      throw err;
    }
  } else {
    // Mock return URL
    sectionUrl = `https://docs.google.com/document/d/${docId || 'mock-doc-id'}/edit#heading=h.mock-section-${isoWeek.toLowerCase()}`;
    console.log(`[DOCS DELIVERY MOCK] Appended report mock URL: ${sectionUrl}`);
  }

  return {
    skipped: false,
    sectionUrl
  };
}
