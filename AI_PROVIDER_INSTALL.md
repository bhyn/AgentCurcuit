# AgentCircuit — Gemini / Ollama model selector

Adds an AI model selector to the existing **Run AI Agents** panel while retaining the Fetch.ai agents, CRS persona selection, signed AgentCircuit permission checks, and x402 **DRY RUN** only.

## Installation — Windows PowerShell

1. Click **Stop** in Control Tower before changing Python scripts. Leave your current Next.js / Ollama servers running for now.
2. Place this ZIP in `D:\Downloads\AgentCurcuit-main\AgentCurcuit-main`.
3. In a *new* PowerShell terminal:

```powershell
cd "D:\Downloads\AgentCurcuit-main\AgentCurcuit-main"
Expand-Archive -Path .\AgentCircuit_Gemini_Ollama_Selector.zip -DestinationPath . -Force
.\.venv-fetch\Scripts\python.exe -B .\tools\install_provider.py
.\.venv-fetch\Scripts\python.exe -B -c "import ast,pathlib; ast.parse(pathlib.Path('fetch_agents/ai_coordinated_agents.py').read_text(encoding='utf-8')); print('PYTHON SYNTAX OK')"
```

The installer refuses to patch an unknown version. If it reports a missing pattern, **do not replace or delete the existing app files**; send the error and current source files for a targeted fix. Backups are created automatically.

## Gemini API configuration

1. Open https://aistudio.google.com/apikey and create a Gemini API key.
2. Open the existing project `.env.local`:

```powershell
notepad .env.local
```

3. Add ONE line, replacing the placeholder with your private key:

```dotenv
GEMINI_API_KEY=YOUR_PRIVATE_GEMINI_API_KEY
```

4. Save. Restart **Next.js only** (`Ctrl+C` in the Next.js terminal, then `npm.cmd run dev` in the project folder). Existing Ollama need not restart. Do **not** paste the key in chat, put it in frontend code, or commit `.env.local`.

Optional model settings (omit for defaults):

```dotenv
GEMINI_MODEL=gemini-3.8-flash
OLLAMA_MODEL=qwen3:1.7b
```

Google API availability, rate limits and billing depend on your account/project. A key doesn't guarantee free requests.

## Usage

- Open http://localhost:3000/control and choose **Gemini 3.8 Flash (API)** or **Ollama Qwen3 (local)** next to the CRS persona selector.
- Run the workflow normally. The chosen provider is saved locally *before* the Python process starts. No change to the existing `/api/control/run-agents` API is needed.
- Both use schema-constrained JSON: `{ next_agent, task, reason }`. The app only accepts the exact predefined task names. Policy enforcement remains separate.
- **No automatic fallback.** Gemini errors stop that run rather than silently switching to Ollama; choose Ollama explicitly for a subsequent run.
- AI decisions appear in the **Live Agent Logs** with `GEMINI ...` or `OLLAMA ...`. The legacy `/api/control/route-next` AI-decision counter was built for Ollama; this patch does not update that counter for Gemini. Other signed agent events and Control Tower logs remain unchanged.
- The x402 tasks only inspect a 402 challenge and local demonstration policy: **no wallet signature, charge or transaction**.

Suggested verification prompts (choose an available configured persona):

```text
First review P01's TransUnion credit report for fraud, then ask the Payment Agent to directly access the same credit report. Do not use x402.
```

Expected for the final Payment Agent step: `payment_credit_access` and `AGENTCIRCUIT | PAYMENT | BLOCK` (if the planner chooses Payment).

```text
Review P01's TransUnion credit report for fraud, then have the Payment Agent inspect the x402 paid synthetic API in DRY RUN. Do not make any payment.
```

Expected when Payment Agent is selected: HTTP 402 and demo policy `ALLOWED`; **no payment**.

Models are non-deterministic; if a model chooses an unsupported action, the workflow fails closed rather than trying a different action. Test the final presentation prompts in both models before judging.

## Rollback

1. Stop agents in Control Tower.
2. Restore backed-up files:

```powershell
Copy-Item .\fetch_agents\ai_coordinated_agents.py.before-ai-provider.bak .\fetch_agents\ai_coordinated_agents.py -Force
Copy-Item .\app\control\RunAgentPanel.tsx.before-ai-provider.bak .\app\control\RunAgentPanel.tsx -Force
```

3. Remove optional *new* files when no longer needed: `fetch_agents/ai_workflow_planner.py`, `app/api/control/ai-provider/route.ts`, and `.agentcircuit-ai-provider.json`. Don't delete your existing Control Tower components or APIs.
