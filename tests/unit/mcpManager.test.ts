import * as https from 'https';
import { RemoteRESTClient } from '../../src/delivery/mcpManager';
import { EventEmitter } from 'events';

jest.mock('https');

describe('RemoteRESTClient Unit Tests', () => {
  let mockRequest: jest.Mock;

  beforeEach(() => {
    mockRequest = jest.fn();
    (https.request as any).mockImplementation((options: any, callback: any) => {
      mockRequest(options);
      
      const mockResponse = new EventEmitter() as any;
      mockResponse.statusCode = 200;
      
      // Execute callback with mock response
      callback(mockResponse);
      
      // Emit data and end on response
      process.nextTick(() => {
        mockResponse.emit('data', JSON.stringify({ status: 'success', id: 'mock-123' }));
        mockResponse.emit('end');
      });

      const req = new EventEmitter() as any;
      req.write = jest.fn();
      req.end = jest.fn();
      return req;
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  test('should clean and sanitize remote server URL', () => {
    const client1 = new RemoteRESTClient('https://api.example.com/sse');
    expect((client1 as any).baseUrl).toBe('https://api.example.com');

    const client2 = new RemoteRESTClient('https://api.example.com/');
    expect((client2 as any).baseUrl).toBe('https://api.example.com');
  });

  test('should list tools conforming to standard formats', async () => {
    const client = new RemoteRESTClient('https://api.example.com');
    const result = await client.listTools();
    expect(result.tools).toBeDefined();
    const names = result.tools.map((t: any) => t.name);
    expect(names).toContain('append_markdown');
    expect(names).toContain('create_draft');
  });

  test('should translate append_markdown standard MCP tool call to REST call', async () => {
    const client = new RemoteRESTClient('https://api.example.com');
    const result = await client.callTool({
      name: 'append_markdown',
      arguments: {
        documentId: 'doc-123',
        text: 'Report text'
      }
    });

    expect(result.isError).toBe(false);
    expect(result.content[0].text).toContain('mock-123');
    
    // Check that request options match our expectations
    expect(mockRequest).toHaveBeenCalled();
    const options = mockRequest.mock.calls[0][0];
    expect(options.hostname).toBe('api.example.com');
    expect(options.path).toBe('/append_to_doc');
    expect(options.method).toBe('POST');
  });

  test('should translate create_draft standard MCP tool call to REST call', async () => {
    const client = new RemoteRESTClient('https://api.example.com');
    const result = await client.callTool({
      name: 'create_draft',
      arguments: {
        draft: {
          message: {
            to: ['user@example.com'],
            subject: 'Weekly Review Pulse',
            body: 'Teaser body text'
          }
        }
      }
    });

    expect(result.isError).toBe(false);
    expect(result.content[0].text).toContain('mock-123');
    
    expect(mockRequest).toHaveBeenCalled();
    const options = mockRequest.mock.calls[0][0];
    expect(options.hostname).toBe('api.example.com');
    expect(options.path).toBe('/create_email_draft');
    expect(options.method).toBe('POST');
  });
});
