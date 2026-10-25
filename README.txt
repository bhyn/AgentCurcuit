AgentCircuit Control Tower - x402 summary integration

WHAT CHANGES
- Only app/control/CompactActivityMonitor.tsx is replaced.
- When the Fetch.ai workflow logs X402 activity, the live Agent Activity panel
  shows a small Payment Security summary: HTTP response / policy / settlement.
- When there is no x402 activity in the current runner log, no extra card appears.
- All UI text is English.
- The separate Payments Lab (/control/x402) remains available as a developer
  testing utility; it is not required for normal Control Tower use.
- Real USDC transfers are NOT enabled. The summary shows dry-run results only.

HOW TO APPLY - WINDOWS POWERSHELL
1. Place AgentCircuit_ControlTower_X402.zip in:
   D:\Downloads\AgentCurcuit-main\AgentCurcuit-main
2. In a PowerShell window:
   cd "D:\Downloads\AgentCurcuit-main\AgentCurcuit-main"
   Copy-Item .\app\control\CompactActivityMonitor.tsx .\app\control\CompactActivityMonitor.tsx.before-x402-ui.bak -Force
   Expand-Archive -Path .\AgentCircuit_ControlTower_X402.zip -DestinationPath . -Force
3. Hard-refresh http://localhost:3000/control with Ctrl+Shift+R.
4. Run the existing x402 ALLOW and BLOCK (budget) examples from Run AI Agents.
   Watch Agent Activity > Payment Security · x402 on the right.

NOTES
- Keep Next.js and Ollama running. No npm installation needed.
- The existing app/control/x402 page and API are not deleted.
- No secrets, wallet keys, identities, or payment logic are modified.
- The panel reads /api/control/run-agents and uses the reported log strings.
  It is a UI-level summary, NOT a server-side settlement verification.
