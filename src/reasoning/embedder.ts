import * as https from 'https';
import * as http from 'http';

// Mock sharp in require cache to prevent Node.js v16 engine-incompatibility crash
try {
  const sharpPath = require.resolve('sharp');
  require.cache[sharpPath] = {
    id: sharpPath,
    filename: sharpPath,
    loaded: true,
    exports: {},
    paths: [],
    parent: null
  } as any;
  console.log('[EMBEDDER] Successfully mocked sharp module in require cache.');
} catch (e) {
  // Ignore resolve failures
}

// Polyfill global ReadableStream for Node.js v16.15.1
if (typeof (global as any).ReadableStream === 'undefined') {
  console.log('[EMBEDDER] Polyfilling global.ReadableStream for Node.js compatibility.');
  const { ReadableStream } = require('stream/web');
  (global as any).ReadableStream = ReadableStream;
}

// Polyfill global Blob for Node.js v16.15.1
if (typeof (global as any).Blob === 'undefined') {
  console.log('[EMBEDDER] Polyfilling global.Blob for Node.js compatibility.');
  const { Blob } = require('buffer');
  (global as any).Blob = Blob;
}

// Polyfill global File for Node.js v16.15.1
if (typeof (global as any).File === 'undefined') {
  console.log('[EMBEDDER] Polyfilling global.File for Node.js compatibility.');
  class File extends (global as any).Blob {
    name: string;
    lastModified: number;
    constructor(chunks: any[], name: string, options: any = {}) {
      super(chunks, options);
      this.name = name;
      this.lastModified = options.lastModified || Date.now();
    }
  }
  (global as any).File = File;
}

// Polyfill global DOMException for Node.js v16.15.1
if (typeof (global as any).DOMException === 'undefined') {
  console.log('[EMBEDDER] Polyfilling global.DOMException for Node.js compatibility.');
  class DOMException extends Error {
    constructor(message = '', name = 'DOMException') {
      super(message);
      this.name = name;
    }
  }
  (global as any).DOMException = DOMException;
}

// Polyfill global Headers for Node.js v16.15.1
if (typeof (global as any).Headers === 'undefined') {
  console.log('[EMBEDDER] Polyfilling global.Headers for Node.js compatibility.');
  class Headers {
    private map: Map<string, string> = new Map();
    constructor(init: any = {}) {
      if (init) {
        if (Array.isArray(init)) {
          init.forEach(([k, v]) => this.map.set(k.toLowerCase(), v));
        } else if (typeof init.forEach === 'function') {
          init.forEach((v: string, k: string) => this.map.set(k.toLowerCase(), v));
        } else {
          Object.entries(init).forEach(([k, v]) => this.map.set(k.toLowerCase(), v as string));
        }
      }
    }
    append(name: string, value: string) { this.map.set(name.toLowerCase(), value); }
    delete(name: string) { this.map.delete(name.toLowerCase()); }
    get(name: string) { return this.map.get(name.toLowerCase()) || null; }
    has(name: string) { return this.map.has(name.toLowerCase()); }
    set(name: string, value: string) { this.map.set(name.toLowerCase(), value); }
    forEach(callback: any) { this.map.forEach(callback); }
  }
  (global as any).Headers = Headers;
}

// Polyfill global Response for Node.js v16.15.1
if (typeof (global as any).Response === 'undefined') {
  console.log('[EMBEDDER] Polyfilling global.Response for Node.js compatibility.');
  class Response {
    ok: boolean;
    status: number;
    statusText: string;
    headers: any;
    private _buffer: Buffer;

    constructor(body: any, init: any = {}) {
      this.status = init.status !== undefined ? init.status : 200;
      this.ok = this.status >= 200 && this.status < 300;
      this.statusText = init.statusText || 'OK';
      this.headers = new (global as any).Headers(init.headers);
      this._buffer = Buffer.isBuffer(body) ? body : Buffer.from(body || '');
    }

    get body() {
      const buffer = this._buffer;
      return new (global as any).ReadableStream({
        start(controller: any) {
          controller.enqueue(new Uint8Array(buffer));
          controller.close();
        }
      });
    }

    async arrayBuffer() {
      const buf = this._buffer;
      return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    }

    async json() {
      return JSON.parse(this._buffer.toString());
    }

    async text() {
      return this._buffer.toString();
    }

    async blob() {
      return new (global as any).Blob([this._buffer]);
    }
  }
  (global as any).Response = Response;
}

// Polyfill global fetch for Node.js v16.15.1 which does not have it natively.
// This is critical since @huggingface/transformers relies on fetch to load models.
console.log('[EMBEDDER] Overwriting global.fetch with custom redirect-following polyfill. (Prior type:', typeof (global as any).fetch, ')');
(global as any).fetch = function fetchUrl(url: string, options: any = {}): Promise<any> {
  console.log(`[EMBEDDER FETCH] Fetching: ${url}`);
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    client.get(url, (res: any) => {
      // Follow HTTP redirects (301, 302, 303, 307, 308)
      if (res.statusCode && [301, 302, 303, 307, 308].includes(res.statusCode)) {
        const redirectUrl = res.headers.location;
        if (redirectUrl) {
          const resolvedUrl = redirectUrl.startsWith('http') 
            ? redirectUrl 
            : new URL(redirectUrl, url).toString();
          console.log(`[EMBEDDER FETCH] Redirecting to: ${resolvedUrl}`);
          return resolve(fetchUrl(resolvedUrl, options));
        }
      }

      const chunks: any[] = [];
      res.on('data', (chunk: any) => chunks.push(chunk));
      res.on('end', () => {
        const buffer = Buffer.concat(chunks);
        console.log(`[EMBEDDER FETCH] Finished downloading: ${url} (${buffer.length} bytes), Status: ${res.statusCode}`);
        resolve(new (global as any).Response(buffer, {
          status: res.statusCode,
          statusText: res.statusMessage,
          headers: res.headers
        }));
      });
    }).on('error', (err: any) => {
      console.error(`[EMBEDDER FETCH ERROR] Fail on: ${url}`, err);
      reject(err);
    });
  });
};

let pipelinePromise: any = null;

/**
 * Returns a lazy-loaded pipeline instance for feature extraction (embeddings).
 */
async function getPipeline(): Promise<any> {
  if (!pipelinePromise) {
    console.log('[EMBEDDER] Initializing local bge-small-en-v1.5 model...');
    // We import dynamically to ensure the fetch polyfill is set up first
    const { pipeline, env } = await import('@huggingface/transformers');
    
    // Set clean local cache directory to avoid any previously corrupted cache files
    env.cacheDir = require('path').join(process.cwd(), '.model_cache');
    env.allowLocalModels = false;
    
    pipelinePromise = pipeline('feature-extraction', 'Xenova/bge-small-en-v1.5');
  }
  return pipelinePromise;
}

/**
 * Generates vector embeddings for a given batch of texts using Xenova/bge-small-en-v1.5 locally.
 */
export async function generateEmbeddings(texts: string[]): Promise<number[][]> {
  const extractor = await getPipeline();
  const embeddings: number[][] = [];
  
  console.log(`[EMBEDDER] Generating embeddings for ${texts.length} items...`);
  
  // Process sequentially to keep memory usage low and prevent concurrency issues in Node.js
  for (let i = 0; i < texts.length; i++) {
    const text = texts[i];
    
    // Fallback for empty strings
    if (!text.trim()) {
      embeddings.push(new Array(384).fill(0)); // bge-small has 384 dimensions
      continue;
    }
    
    try {
      const output = await extractor(text, { pooling: 'mean', normalize: true });
      const vector = Array.from(output.data) as number[];
      embeddings.push(vector);
      
      if ((i + 1) % 50 === 0 || i === texts.length - 1) {
        console.log(`[EMBEDDER] Progress: ${i + 1}/${texts.length} generated.`);
      }
    } catch (err: any) {
      console.error(`[EMBEDDER ERROR] Failed to generate embedding for text: "${text.substring(0, 30)}..."`, err);
      embeddings.push(new Array(384).fill(0)); // Push dummy vector
    }
  }
  
  return embeddings;
}
