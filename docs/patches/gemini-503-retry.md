# AgentCircuit — Gemini 503 Retry Fix

## What it fixes

The Gemini API returns HTTP 503 (temporarily unavailable / overloaded). Before this patch, a single 503 stopped the workflow immediately. This patch makes only the AI planning request retry up to **3 total attempts**, waiting 1 second and then 2 seconds between retryable failures. It also retains the previous Gemini responseSchema compatibility fix.

- No automatic provider fallback; switch explicitly to Ollama if Gemini remains unavailable.
- Never retries agent requests, data pulls, or payments; only the AI planning HTTP request.
- No actual x402 payment is triggered.
- It does not touch RunAgentPanel, Control Tower, API routes, signing keys, Next.js or Ollama.
- Gemini 400/401/403 errors are NOT retried.

## Install on Windows

Click **Stop** for current agents in Control Tower first. Save this ZIP into the project root:

`D:\Downloads\AgentCurcuit-main\AgentCurcuit-main`

```powershell
cd "D:\Downloads\AgentCurcuit-main\AgentCurcuit-main"
Expand-Archive -Path .\AgentCircuit_Gemini_503_SafePatch.zip -DestinationPath . -Force
.\.venv-fetch\Scripts\python.exe -B .\tools\patch_gemini_503.py
.\.venv-fetch\Scripts\python.exe -B -c "import ast,pathlib; ast.parse(pathlib.Path('fetch_agents/ai_workflow_planner.py').read_text(encoding='utf-8')); print('PYTHON SYNTAX OK')"
```

Then click **Run AI Agents** again with Gemini. Keep the existing Next.js and Ollama servers running.

## If HTTP 503 continues

The Google server or access for your API key may still be unavailable. Try a different official stable model such as `gemini-3.6-flash`:

```powershell
notepad .env.local
```

Add or update exactly one line:

```dotenv
GEMINI_MODEL=gemini-3.6-flash
```

Save and click **Stop**, then **Run AI Agents** to launch a fresh Python process. No API key needs to be shared. Model choice UI still shows "Gemini 3.8 Flash" because this patch does not alter UI copy, so the precise model is determined by the env var. If neither Gemini model works, choose Ollama in Control Tower for an offline demo.

## Rollback

Stop agents and restore:

```powershell
Copy-Item .\fetch_agents\ai_workflow_planner.py.before-gemini-503.bak .\fetch_agents\ai_workflow_planner.py -Force
```
