# Weekly Product Review Pulse - Implementation Plan

Implement the **Weekly Product Review Pulse** automation tool, focused strictly on aggregating and analyzing **Google Play reviews** for the **Groww** application. The system will leverage clustering algorithms (UMAP + HDBSCAN), an LLM synthesis engine with quote validation, and deliver reports to Google Docs and Gmail via Model Context Protocol (MCP) servers.

## User Review Required

> [!IMPORTANT]
> This system operates as an MCP client. It does **not** handle OAuth credentials directly. Before deployment, you must ensure the following are available in your local environment:
> 1. A running **Google Docs MCP Server** configured with access to your target document.
> 2. A running **Gmail MCP Server** configured with access to your email account.

> [!WARNING]
> To run the reasoning layer (LLM Clustering Synthesis), the system will require access to the **Groq API**. You will need to provide a `GROQ_API_KEY` in the `.env` configuration.
> *   **Model**: `llama-3.3-70b-versatile`
> *   **Limits to respect**: 30 RPM (Requests Per Minute), 12K TPM (Tokens Per Minute), 1K RPD (Requests Per Day), 100K TPD (Tokens Per Day).

## Design Decisions (Closed Questions)

> [NOTE]
> 1. **LLM Provider**: **Groq API** calling `llama-3.3-70b-versatile`. We will build a rate-limiter wrapper to ensure we stay safely below the 30 RPM and 12K TPM limits.
> 2. **Embedding Model**: Local **`bge-small`** model running in-process via `@huggingface/transformers` (or Xenova/bge-small-en-v1.5). This eliminates API costs and rate-limiting issues for the embedding step.

## Open Questions

> [!IMPORTANT]
> 1. **Target Google Doc**: Do you have an existing Google Doc ID that we should target for Groww, or should the system attempt to create a new one via the MCP server if it doesn't find one?

---

## Proposed Changes

### Component 1: Project Configuration & Setup

Initialize the TypeScript project structure, install dependencies, and define runtime parameters.

#### [NEW] [package.json](file:///c:/Users/aishw/Documents/Review%20Analysis/package.json)
*   Define metadata, scripts (`build`, `dev`, `run-pulse`), and dependencies:
    *   `google-play-scraper` (for review retrieval)
    *   `@modelcontextprotocol/sdk` (for connecting to MCP servers)
    *   `dotenv` (for API key configurations)
    *   `mathjs` / math libraries (needed for basic clustering math if not using external APIs)
    *   `groq-sdk` (for LLM orchestration)
    *   `@huggingface/transformers` (to run the `bge-small` embedding model locally)

#### [NEW] [tsconfig.json](file:///c:/Users/aishw/Documents/Review%20Analysis/tsconfig.json)
*   Configure the TypeScript compiler targeting Node v18+ with `commonjs` or standard ES modules.

#### [NEW] [config.ts](file:///c:/Users/aishw/Documents/Review%20Analysis/src/config.ts)
*   Define and validate environment variables: `GROQ_API_KEY`, Google Doc ID for Groww, stakeholder email distribution list, run environment (dev/prod), and lookback window size (defaults to 8–12 weeks).

---

### Component 2: Ingestion & Security

Fetch Google Play reviews for Groww and scrub PII to secure review data before analysis.

#### [NEW] [playStoreScraper.ts](file:///c:/Users/aishw/Documents/Review%20Analysis/src/ingestion/playStoreScraper.ts)
*   Scrape reviews using `google-play-scraper` for app ID `com.nextbillion.groww`.
*   Implement date filtering to isolate reviews from the specified week/rolling lookback.
*   Support a CLI parameter to target past ISO weeks for backfilling.

#### [NEW] [piiScrubber.ts](file:///c:/Users/aishw/Documents/Review%20Analysis/src/security/piiScrubber.ts)
*   Scrub PII (phone numbers, email patterns, customer IDs) from review text.
*   Treat all text purely as data; sanitize any leading slash commands or instructions to prevent LLM prompt injection.

---

### Component 3: Clustering & LLM Reasoning Engine

Generate embeddings, run clustering, summarize themes, and programmatically validate LLM outputs.

#### [NEW] [embedder.ts](file:///c:/Users/aishw/Documents/Review%20Analysis/src/reasoning/embedder.ts)
*   Initialize and run `Xenova/bge-small-en-v1.5` (or similar `bge-small` variant) locally using `@huggingface/transformers`.
*   Generate dense vector representations for all scrubbed reviews in memory.

#### [NEW] [clusterer.ts](file:///c:/Users/aishw/Documents/Review%20Analysis/src/reasoning/clusterer.ts)
*   Implement UMAP dimensionality reduction (using a lightweight JS/TS port or external API service).
*   Implement HDBSCAN (or equivalent density-based clustering algorithm, e.g. DBSCAN) to find tight clusters of user feedback.

#### [NEW] [summarizer.ts](file:///c:/Users/aishw/Documents/Review%20Analysis/src/reasoning/summarizer.ts)
*   Format cluster review logs and feed them to Groq API using the `groq-sdk`.
*   Implement a rate-limiter queue or retry helper with backoff to stay strictly within the 30 RPM and 12K TPM boundaries of `llama-3.3-70b-versatile`.
*   Request JSON output containing: Theme Name, Description, Action Items, and representative quotes.

#### [NEW] [quoteValidator.ts](file:///c:/Users/aishw/Documents/Review%20Analysis/src/validation/quoteValidator.ts)
*   Perform programmatical text verification: ensure each quote output by the LLM is found verbatim inside the source review list. Raise warnings or discard quotes that fail.

---

### Component 4: Rendering & MCP Workspace Delivery

Format outputs and interact with Google Workspace using MCP servers.

#### [NEW] [docsRenderer.ts](file:///c:/Users/aishw/Documents/Review%20Analysis/src/rendering/docsRenderer.ts)
*   Compile insights JSON into formatted structural batch-update payloads (headings, lists, text formatting) for Google Docs.

#### [NEW] [emailRenderer.ts](file:///c:/Users/aishw/Documents/Review%20Analysis/src/rendering/emailRenderer.ts)
*   Construct plain text and HTML emails containing top themes and a link directly pointing to the appended Google Doc section.

#### [NEW] [mcpManager.ts](file:///c:/Users/aishw/Documents/Review%20Analysis/src/delivery/mcpManager.ts)
*   Establish connections to the Google Docs and Gmail MCP servers. Provide wrapper methods for invoking remote tools.

#### [NEW] [docsDelivery.ts](file:///c:/Users/aishw/Documents/Review%20Analysis/src/delivery/docsDelivery.ts)
*   Check if a section for the targeted ISO week already exists in the document.
*   If not, invoke the Docs MCP tools to write the report section and generate a stable anchor URL.

#### [NEW] [gmailDelivery.ts](file:///c:/Users/aishw/Documents/Review%20Analysis/src/delivery/gmailDelivery.ts)
*   Invoke the Gmail MCP tool to draft (in dev/staging) or send (in prod) the teaser email.

---

### Component 5: Orchestrator & Local State Store

Manage the main application sequencer, CLI commands, and run logs database.

#### [NEW] [index.ts](file:///c:/Users/aishw/Documents/Review%20Analysis/src/index.ts)
*   Entry point file coordinating the entire sequence (Ingestion -> Scrubbing -> Clustering -> LLM -> Render -> Delivery).
*   Support command arguments for specifying products (scoped to Groww), targeted ISO weeks, and mode settings (dry-run, staging, prod).
*   Maintain a local file-based database (e.g. `data/run_log.json`) to check run history and log run metrics for audit trails.

---

### Component 6: Web Dashboard & API Server

Provide a user-friendly graphical interface to run the analysis, view previous report summaries, and download reports.

#### [NEW] [server.ts](file:///c:/Users/aishw/Documents/Review%20Analysis/src/server.ts)
*   Implement a lightweight Express server (default port `3000`).
*   Define standard REST endpoints:
    *   `GET /api/reports`: Lists available reports in `data/reports/`.
    *   `GET /api/reports/:week`: Serves a specific report's full JSON structure.
    *   `POST /api/run-pulse`: Programmatically triggers the review pulse pipeline.
    *   `GET /api/reports/:week/download`: Downloads a formatted Markdown version of the report.
*   Serve static assets from the `public/` directory.

#### [MODIFY] [index.ts](file:///c:/Users/aishw/Documents/Review%20Analysis/src/index.ts)
*   Refactor the sequencer logic to be exportable as `runPulsePipeline(options)`.
*   Store completed execution summaries (metadata + clustering themes) locally in `data/reports/groww_{week}.json` upon successful pipeline runs.

#### [NEW] [index.html](file:///c:/Users/aishw/Documents/Review%20Analysis/public/index.html)
*   Create a modern semantic HTML dashboard framework.
*   Include containers for report history navigation, active report dashboard, triggers, and download buttons.

#### [NEW] [style.css](file:///c:/Users/aishw/Documents/Review%20Analysis/public/style.css)
*   Apply premium dark-theme styling matching Groww's branding (mint/emerald highlights `#00d09c` and deep slate backgrounds `#090d16`).
*   Use glassmorphic cards, responsive flex/grid layouts, custom scrollbars, and hover animations.

#### [NEW] [app.js](file:///c:/Users/aishw/Documents/Review%20Analysis/public/app.js)
*   Handle client-side interactivity, state management (active report, history), loading states, and API requests to the Express server.

#### [MODIFY] [package.json](file:///c:/Users/aishw/Documents/Review%20Analysis/package.json)
*   Add `"express"` dependency and `"@types/express"` devDependency.
*   Add `"server"` run script to start the server.

---

## 📈 Implementation Status & Completion
All components of this implementation plan have been completed and verified:
- [x] Project Configuration & Setup
- [x] Ingestion & Security
- [x] Clustering & LLM Reasoning Engine
- [x] Rendering & MCP Workspace Delivery
- [x] Orchestrator & Local State Store
- [x] Web Dashboard & API Server

---

## Verification Plan

### Automated Tests
Run validation scripts and unit tests:
- `npm run test` to execute unit tests verifying:
  - PII scrubbing patterns.
  - Quote verification string matching logic.
  - Correct formatting of the generated JSON output structures.
- All 14 tests in 4 suites are passing.

### Manual Verification
1. **Scraping Verification**: Run a CLI command (`npm run run-pulse -- --dry-run`) to verify that Google Play reviews for Groww are fetched and parsed correctly.
2. **LLM Output & Quote Check**: Run a dry run and inspect the generated JSON report to verify that themes are accurately summarized and quotes match source reviews verbatim.
3. **MCP Integration (Staging)**: Run in staging mode (`npm run run-pulse -- --env staging`). Validate:
   - A new dated section is appended to the Groww Google Doc.
   - A draft email is created in Gmail containing a link referencing the newly created Doc section.
4. **Idempotency Check**: Run the same command immediately after. Verify that the system logs a skip action and does not modify the Google Doc or create new email drafts.
5. **Dashboard UI Verification**: Express server started successfully on `http://localhost:3000`. Dropdown, stakeholder persistence, and email draft generation verified via browser automation.
