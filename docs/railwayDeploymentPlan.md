# Railway Deployment Plan — reviewAnalysis Web App

This document provides a guide to deploying the **Weekly Review Pulse Dashboard** to [Railway](https://railway.app). Since the project has been updated to run the Express server (`node dist/server.js`) on the default `start` script, Railway will automatically detect, build, and run the project out-of-the-box using **Nixpacks** (Railway's default builder).

---

## 1. Setup & Requirements

- A [Railway](https://railway.app) account.
- The codebase pushed to your GitHub repository: `https://github.com/achukkapalli/reviewAnalysis`.
- Configured environment variables (see below).

---

## 2. Environment Variables Configuration

In the Railway Dashboard, navigate to your service, open the **Variables** tab, and configure the following variables:

| Variable Name | Recommended Value | Description |
| :--- | :--- | :--- |
| `NODE_ENV` | `production` | Enables production optimizations in Express and delivery modules. |
| `GROQ_API_KEY` | *your_groq_api_key* | Needed for LLM theme synthesis (via Groq Llama-3.3). |
| `GROWW_DOC_ID` | `1JbdYb2GD2C7pUMNe00CH9HE57H8HWGGnYiwywK5FlT4` | Target Google Doc ID for report updates. |
| `STAKEHOLDER_EMAILS` | *emails_comma_separated* | Stakeholder distribution list (e.g. `chowdaryaishwarya7@gmail.com, aishwarya@groww.in`). |
| `MCP_SERVER_URL` | `https://aishwarya-mcp-server-production-40d6.up.railway.app/sse` | Pointing to your Google Docs/Gmail MCP server SSE endpoint. |
| `PORT` | *Automatic* | Railway automatically injects the `PORT` variable which Express listens to. |

---

## 3. Step-by-Step Deployment Steps

### Step 1: Create a Service on Railway
1. Go to your [Railway Dashboard](https://railway.app).
2. Click **New Project** → **Deploy from GitHub repository**.
3. Select your repository: `achukkapalli/reviewAnalysis`.
4. Click **Deploy Now**.

### Step 2: Configure variables
1. Once the service is created, click on it to open its panel.
2. Select the **Variables** tab.
3. Click **New Variable** and add each variable listed in the table above.
4. Railway will automatically trigger a redeploy when variables are updated.

### Step 3: Generate a Domain
1. In the service panel, navigate to the **Settings** tab.
2. Under **Networking**, click **Generate Domain**.
3. Railway will generate a public URL (e.g. `https://reviewanalysis-production.up.railway.app`).

---

## 4. Verification

After the deployment build completes (visible in the **Deployments** tab on Railway), you can verify the dashboard is running:

1. Open the public generated URL in your browser.
2. Confirm that the premium dark-themed dashboard loads successfully.
3. Test selecting a week in the dropdown and confirm that the reports load.
4. Try updating the stakeholder list and check that a new draft email is created successfully via the remote MCP server connection!
