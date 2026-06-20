import { config } from '../config';
import { loadESM } from '../utils/esmLoader';
import * as https from 'https';

// Polyfill EventSource globally for SSE transport support in Node.js
const EventSource = require('eventsource');
(global as any).EventSource = EventSource;

let ClientClass: any = null;
let StdioClientTransportClass: any = null;

let gdocsClient: any = null;
let gmailClient: any = null;

function makeRESTPost(urlStr: string, body: any): Promise<string> {
  return new Promise((resolve, reject) => {
    try {
      const url = new URL(urlStr);
      const postData = JSON.stringify(body);
      
      const options = {
        hostname: url.hostname,
        port: url.port || (url.protocol === 'https:' ? 443 : 80),
        path: url.pathname + url.search,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData)
        }
      };
      
      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            resolve(data);
          } else {
            reject(new Error(`Server returned status ${res.statusCode}: ${data}`));
          }
        });
      });
      
      req.on('error', (e) => reject(e));
      req.write(postData);
      req.end();
    } catch (err) {
      reject(err);
    }
  });
}

export class RemoteRESTClient {
  private baseUrl: string;
  constructor(baseUrl: string) {
    this.baseUrl = baseUrl.trim();
    if (this.baseUrl.endsWith('/sse')) {
      this.baseUrl = this.baseUrl.slice(0, -4);
    }
    if (this.baseUrl.endsWith('/')) {
      this.baseUrl = this.baseUrl.slice(0, -1);
    }
  }

  async listTools() {
    return {
      tools: [
        { name: 'read_document', description: 'Read document' },
        { name: 'append_markdown', description: 'Append markdown' },
        { name: 'append_text', description: 'Append text' },
        { name: 'create_draft', description: 'Create draft' }
      ]
    };
  }

  async callTool(request: { name: string; arguments: any }) {
    const { name, arguments: args } = request;
    
    if (name === 'read_document') {
      return {
        isError: false,
        content: [{ type: 'text', text: '' }]
      };
    }
    
    if (name === 'append_markdown' || name === 'append_text') {
      const docId = args.documentId || args.doc_id;
      const content = args.text || args.markdown;
      
      console.log(`[REST CLIENT] Appending to Google Doc ${docId} via hosted API`);
      const responseText = await makeRESTPost(`${this.baseUrl}/append_to_doc`, {
        doc_id: docId,
        content: content
      });
      
      let isError = false;
      try {
        const parsed = JSON.parse(responseText);
        if (parsed.status === 'error' || parsed.error) {
          isError = true;
        }
      } catch (e) {}
      
      return {
        isError: isError,
        content: [{ type: 'text', text: responseText }]
      };
    }
    
    if (name === 'create_draft') {
      const msg = args.draft?.message || {};
      const toStr = Array.isArray(msg.to) ? msg.to.join(', ') : (msg.to || '');
      const subject = msg.subject || '';
      const body = msg.body || msg.htmlBody || '';
      
      console.log(`[REST CLIENT] Creating Gmail draft via hosted API`);
      const responseText = await makeRESTPost(`${this.baseUrl}/create_email_draft`, {
        to: toStr,
        subject,
        body
      });
      
      let isError = false;
      try {
        const parsed = JSON.parse(responseText);
        if (parsed.status === 'error' || parsed.error) {
          isError = true;
        }
      } catch (e) {}
      
      return {
        isError: isError,
        content: [{ type: 'text', text: responseText }]
      };
    }
    
    throw new Error(`Unsupported remote tool: ${name}`);
  }
  
  async close() {
    // No-op for REST client
  }
}

/**
 * Helper to dynamically resolve environment command configuration for Stdio clients.
 */
function getTransportForServer(envPrefix: string, defaultCmd: string, defaultArgs: string[]): any {
  const command = process.env[`${envPrefix}_COMMAND`] || defaultCmd;
  const argsStr = process.env[`${envPrefix}_ARGS`];
  const args = argsStr ? argsStr.split(',').map(a => a.trim()) : defaultArgs;

  if (!command) {
    console.warn(`[MCP] Missing command configuration for ${envPrefix}. Connection will be skipped.`);
    return null;
  }

  console.log(`[MCP] Spawning ${envPrefix} server via command: "${command} ${args.join(' ')}"`);
  return new StdioClientTransportClass({
    command: command,
    args: args
  });
}

/**
 * Initializes connections to the Google Docs and Gmail MCP servers.
 * Supports connecting to a remote MCP server via SSE if mcpServerUrl is configured.
 */
export async function initializeMCP(): Promise<void> {
  // If in dry-run or mock mode, we skip connecting to real servers.
  if (process.env.MOCK_MCP === 'true') {
    console.log('[MCP] Running in mock/dry-run mode. Skipping actual MCP connections.');
    return;
  }

  try {
    if (config.mcpServerUrl) {
      console.log(`[MCP] Initializing Remote REST API Client wrapper for: ${config.mcpServerUrl}`);
      const client = new RemoteRESTClient(config.mcpServerUrl);
      gdocsClient = client;
      gmailClient = client;
      return;
    }

    console.log('[MCP] Dynamically importing MCP SDK modules for CommonJS compatibility...');
    
    // Dynamic import of ESM-only SDK
    const clientModule = await loadESM('@modelcontextprotocol/sdk/client/index.js');
    ClientClass = clientModule.Client;

    // Fallback: Local stdio transport
    console.log('[MCP] No remote MCP URL configured. Falling back to local stdio servers.');
    const stdioModule = await loadESM('@modelcontextprotocol/sdk/client/stdio.js');
    StdioClientTransportClass = stdioModule.StdioClientTransport;

    // 1. Initialize Google Docs MCP client
    const docsTransport = getTransportForServer('GDOCS_MCP', 'npx', ['-y', '@modelcontextprotocol/server-google-docs']);
    if (docsTransport) {
      gdocsClient = new ClientClass({ name: 'pulse-gdocs-client', version: '1.0.0' }, { capabilities: {} });
      await gdocsClient.connect(docsTransport);
      console.log('[MCP] Connected successfully to Google Docs MCP server.');
    }

    // 2. Initialize Gmail MCP client
    const gmailTransport = getTransportForServer('GMAIL_MCP', 'npx', ['-y', '@modelcontextprotocol/server-gmail']);
    if (gmailTransport) {
      gmailClient = new ClientClass({ name: 'pulse-gmail-client', version: '1.0.0' }, { capabilities: {} });
      await gmailClient.connect(gmailTransport);
      console.log('[MCP] Connected successfully to Gmail MCP server.');
    }
  } catch (err: any) {
    console.error('[MCP ERROR] Failed to connect to MCP server(s):', err.message || err);
    console.warn('[MCP WARNING] Falling back to mock delivery.');
    gdocsClient = null;
    gmailClient = null;
  }
}

/**
 * Disconnects any open MCP client sessions.
 */
export async function closeMCP(): Promise<void> {
  const docs = gdocsClient;
  const gmail = gmailClient;
  gdocsClient = null;
  gmailClient = null;

  try {
    if (docs) {
      await docs.close();
    }
  } catch (err) {
    // Ignore cleanup errors
  }

  try {
    if (gmail && gmail !== docs) {
      await gmail.close();
    }
  } catch (err) {
    // Ignore cleanup errors
  }
  
  console.log('[MCP] Sessions closed.');
}

/**
 * Dynamically resolves and invokes an MCP tool across the connected client.
 */
export async function callMCPTool(client: any, possibleToolNames: string[], args: any): Promise<any> {
  if (!client) {
    console.log(`[MCP MOCK] Mock tool invocation for: [${possibleToolNames.join('/')}] with args:`, JSON.stringify(args, null, 2));
    return { mock: true, sectionUrl: 'https://docs.google.com/document/d/mock-doc-id#heading=h.mock-section-id', messageId: 'mock-msg-12345' };
  }

  // Find the exact tool name match from the server's list
  const toolsResponse = await client.listTools();
  const availableTools = toolsResponse.tools.map((t: any) => t.name);
  const selectedTool = possibleToolNames.find(name => availableTools.includes(name));

  if (!selectedTool) {
    throw new Error(`None of the target tools [${possibleToolNames.join(', ')}] were found on the MCP server. Available tools: ${availableTools.join(', ')}`);
  }

  console.log(`[MCP] Invoking tool "${selectedTool}"`);
  const result = await client.callTool({
    name: selectedTool,
    arguments: args
  });

  if (result.isError) {
    throw new Error(`MCP tool execution failed: ${JSON.stringify(result.content)}`);
  }

  let unpacked: any = result.content;
  if (Array.isArray(unpacked) && unpacked.length === 1) {
    const item = unpacked[0];
    if (item.type === 'text') {
      try {
        unpacked = JSON.parse(item.text);
      } catch {
        unpacked = item.text;
      }
    } else if (item.type === 'json') {
      unpacked = item.json;
    }
  }

  return unpacked;
}

export function getGDocsClient(): any {
  return gdocsClient;
}

export function getGmailClient(): any {
  return gmailClient;
}
