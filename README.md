# Groww Weekly Review Pulse 🚀

An automated weekly customer feedback intelligence pipeline and web dashboard for the **Groww** application. The system scrapes Google Play Store customer reviews, scrubs PII, runs local vector embedding and clustering algorithms, synthesizes recurring feedback themes using LLMs, verifies quotes verbatim, and delivers reports directly to Google Workspace (Docs/Gmail) via Model Context Protocol (MCP) servers.

It also features a premium **glassmorphic dark-mode web dashboard** to browse weekly reports, manage stakeholder distribution lists, and trigger teaser email drafts.

---

## 🏗️ System Overview & Architecture

```
[Ingestion] Scrape reviews -> Scrub PII
      ↓
[Analytics] Local Embeddings -> DBSCAN Clustering -> LLM Theme Synthesis
      ↓
[Validation] Programmatic Verbatim Quote Matching Check
      ↓
[Delivery] Appends to Google Doc (via MCP) -> Creates Gmail Draft (via MCP)
      ↓
[Dashboard] Serving UI at localhost:3000 for visualization and config updates
```

For the full detailed specifications, check out [docs/architecture.md](file:///c:/Users/aishw/Documents/Review%20Analysis/docs/architecture.md).

---

## 🌟 Core Features

- **Automated Play Store Ingestion**: Scrapes Google Play Store reviews for the target app ID (`com.nextbillion.groww`) with lookback date boundaries.
- **PII Scrubbing**: Cleans email patterns, phone numbers, and database IDs from review logs before clustering or LLM exposure.
- **Local Embedding Execution**: Generates text embeddings locally using Xenova's `bge-small` model to eliminate API overhead and token limits.
- **Density-Based Clustering**: Groups reviews by sentiment profile using DBSCAN algorithms, isolating unclustered noise.
- **LLM Theme Namer & Quote Extractor**: Calls Llama-3.3-70b (via Groq API) to name clusters, write actionable ideas, and extract representative quotes.
- **Verbatim Quote Validator**: Compares LLM-extracted quotes against raw input review logs to verify authenticity and eliminate hallucinations.
- **Model Context Protocol (MCP) Delivery**: Appends sections dynamically to a Google Doc and drafts a teaser email using standard hosted or stdio MCP Google Workspace servers.
- **Premium Web Dashboard**: A dark financial-app UI displaying:
  - Weekly report summaries (themes, description, verbatim quotes, action items).
  - Historical dropdown selector showing previous run logs.
  - Live status indicators of Google Doc and Gmail delivery (with deep links to the Doc).
  - Stakeholder list manager that automatically triggers Gmail teaser drafts upon updates.
  - Manual analysis pipeline trigger for arbitrary ISO weeks.

---

## 🛠️ Technology Stack

- **Backend**: Node.js, TypeScript, Express API Server.
- **Embeddings**: `@huggingface/transformers` (local in-process model execution).
- **Reasoning**: Groq SDK (`llama-3.3-70b-versatile`).
- **Integrations**: `@modelcontextprotocol/sdk` (SSE and Stdio server bindings).
- **Frontend**: HTML5, Vanilla CSS3 (Custom variables, glassmorphic cards, Outfit font), client-side JavaScript.

---

## 🚀 Getting Started

### 1. Prerequisites
Ensure you have Node.js (v18+) and npm installed.

### 2. Installation
Clone the repository and install the dependencies:
```bash
npm install
```

### 3. Environment Configuration
Create a `.env` file in the root directory (based on [`.env.example`](file:///c:/Users/aishw/Documents/Review%20Analysis/.env.example)) and specify your configuration parameters:
```ini
GROQ_API_KEY=your_groq_api_key
GROWW_DOC_ID=your_shared_google_doc_id
STAKEHOLDER_EMAILS=stakeholder1@gmail.com, stakeholder2@gmail.com
NODE_ENV=development
LOOKBACK_WEEKS=1

# Remote MCP Server configuration (if using hosted SSE server)
MCP_SERVER_URL=https://your-mcp-server.up.railway.app/sse

# Local MCP Command config (if using stdio fallback)
GDOCS_MCP_COMMAND=python
GDOCS_MCP_ARGS=path/to/mcp_server.py
```

---

## 🏃 Run Commands

### Start the Web Dashboard & API Server
Run the Express backend (runs at `http://localhost:3000`):
```bash
npm run server
```

### Run the CLI Orchestrator
Execute a manual analysis pipeline run for the current week:
```bash
npm run run-pulse
```

To force a run or target a specific past ISO week:
```bash
npm run run-pulse -- --week 2026-W22 --force
```

To test pipeline outputs without writing to real Google Workspace docs (mock mode):
```bash
npm run run-pulse -- --dry-run
```

### Run Unit Tests
Execute the Jest test suite:
```bash
npm run test
```

---

## 🔒 Security & Privacy

1. **Local Embeddings**: The text vectorization process runs locally on your machine—sensitive text logs are never uploaded to embedding API services.
2. **PII Scrubbing**: Sanitizer scrub patterns run locally *prior* to vectorization or LLM prompt compilation.
3. **No Embedded Secrets**: Google OAuth credentials and tokens reside strictly in the configuration of your MCP servers, decoupled entirely from this repository.
