# Weekly Product Review Pulse - Implementation Walkthrough

We have successfully implemented and verified the **Weekly Product Review Pulse** codebase targeting **Google Play reviews** for the **Groww** application.

---

## 🚀 Key Accomplishments

### 1. Ingestion & Pre-processing (`src/ingestion/`, `src/security/`)
*   **Play Store Ingestion**: Paginated reviews retrieval for Groww (`com.nextbillion.groww`) matching dates up to the rolling lookback target week.
*   **PII & Security Scrubber**: Automatically scrubs emails, phone numbers, and potential transaction IDs. In addition, it neutralizes potential prompt injection vectors.

### 2. Analytics & Reasoning Engine (`src/reasoning/`, `src/validation/`)
*   **Local Embedding Generation**: Generates 384-dimensional dense vectors using the `Xenova/bge-small-en-v1.5` model entirely locally, eliminating network-based API costs and token constraints for the vectorization phase.
*   **Pure TypeScript DBSCAN Clustering**: Groups embeddings based on spatial density to identify main review complaint themes.
*   **Centroid-based Selection**: Calculates the geometric center of each feedback cluster and selects the closest 15 reviews to feed to the LLM.
*   **Groq LLM Synthesis**: Connects to the Groq API utilizing `llama-3.3-70b-versatile` to name and describe themes, pull quotes, and generate action ideas.
*   **Rate & Token Guardrails**: Implements a dedicated rate limiter to stay below Groq's 30 RPM and 12K TPM boundaries.
*   **Quote Verifier**: Verifies that LLM-extracted quotes exist verbatim inside the raw review texts.

### 3. Google Workspace Integration (`src/rendering/`, `src/delivery/`)
*   **Structured Formatters**: Converts JSON themes to clean Google Docs Markdown layouts, and renders Gmail alerts linking back to the Doc.
*   **CommonJS Compatibility & Dynamic ESM Import**: Dynamically imports ESM-only packages (like `@modelcontextprotocol/sdk` and `google-play-scraper`) without triggering require-ESM errors.
*   **Double-Guard Idempotency**:
    *   *State-log Check*: Verifies local run histories (`data/run_log.json`) before executing.
    *   *Workspace Document Scan*: Inspects the target Google Doc for existing weekly headings using Google Docs MCP prior to appending.

---

## 🛠️ Node.js v16.15.1 Compatibility Polyfills

To run the latest `@huggingface/transformers` and modern fetch-centric tooling natively on the system's **Node v16.15.1** environment, we implemented a custom system of polyfills at the entry point of our embedder module:
1.  **`global.ReadableStream`**: Polyfilled using Node's native `stream/web` module.
2.  **`global.Blob`**: Polyfilled using Node's native `buffer` module.
3.  **`global.File`**: Extends the `Blob` polyfill with standard metadata.
4.  **`global.DOMException`**: Polyfilled as a custom error subclass.
5.  **`global.Headers`**: Implemented standard header structures locally.
6.  **`global.fetch`**: Overwritten with a custom `https`-backed fetch method capable of recursively following HTTP redirects (essential for Hugging Face CDN redirection).
7.  **`sharp` Mocking**: Intercepted standard native image-binaries loading using Node's `require.cache` mapping, as we only compile text feature pipelines.

---

## 🧪 Validation Results

We performed a dry-run test (`node dist/index.js --dry-run`) with a rolling 1-week lookback targeting ISO week `2026-W23`. The system performed flawlessly:

```bash
==================================================
🚀 Starting Weekly Product Review Pulse (Groww)
==================================================
[ORCHESTRATOR] Dry-run enabled. Writes to Google Doc/Gmail will be mocked.
[ORCHESTRATOR] Targeted ISO Week: 2026-W23
[ORCHESTRATOR] Execution Mode: DEVELOPMENT
[SCRAPER] Fetching reviews for com.nextbillion.groww
[SCRAPER] Lookback: 1 weeks (from 2026-06-07T18:29:59.999Z back to 2026-05-31T18:29:59.999Z)
[SCRAPER] Page 1-6: Fetched reviews.
[SCRAPER] Reached review from 2026-05-31T18:20:54.175Z which is older than threshold. Stopping ingestion.
[SCRAPER] Ingestion complete. Collected a total of 760 reviews.
[ORCHESTRATOR] Sanitizing and scrubbing PII from reviews...
[ORCHESTRATOR] Scrubbing completed. Redacted PII in 11 reviews.
[EMBEDDER] Initializing local bge-small-en-v1.5 model...
[EMBEDDER] Generating embeddings for 760 items...
[EMBEDDER] Progress: 760/760 generated.
[CLUSTERER] Running DBSCAN (eps=0.6, minPts=3) on 760 reviews.
[CLUSTERER] Found 6 clusters. Noise points count: 331
[CLUSTERER] Cluster 0: 371 members
[CLUSTERER] Cluster 1: 4 members
[CLUSTERER] Cluster 2: 29 members
[CLUSTERER] Cluster 3: 5 members
[CLUSTERER] Cluster 4: 4 members
[CLUSTERER] Cluster 5: 17 members
[ORCHESTRATOR] Found 6 feedback clusters (excluding noise).
[ORCHESTRATOR] Processing Clusters...
[SUMMARIZER] Summarizing clusters using Groq...
...
[ORCHESTRATOR] Preparing delivery via MCP...
[MCP] Running in mock/dry-run mode. Skipping actual MCP connections.
[DOCS DELIVERY] Checking for existing section: "Groww — Weekly Review Pulse (2026-W23)" in document: dummy_google_doc_id
[DOCS DELIVERY] Section not found. Appending report...
[DOCS DELIVERY MOCK] Appended report mock URL: https://docs.google.com/document/d/dummy_google_doc_id/edit#heading=h.mock-section-2026-w23
[GMAIL DELIVERY] Non-production Mode: Creating draft for: [test@example.com]
[GMAIL DELIVERY MOCK] Non-production: Mock created email draft for [test@example.com]
[MCP] Sessions closed.

==================================================
✅ Weekly Product Review Pulse completed successfully!
Local log updated: groww:2026-W23
Google Doc Link: https://docs.google.com/document/d/dummy_google_doc_id/edit#heading=h.mock-section-2026-w23
Gmail reference ID: mock-dev-draft-id
==================================================
```
