# AgentCircuit

Credit-file lookups for **CRS sandbox test personas**, coordinated by a lead agent that delegates to a Credit agent.

## What it does

Ask for a sandbox persona and AgentCircuit pulls that person's file from **TransUnion, Equifax and Experian**, then reports each bureau separately:

- score and the scoring model used
- no file on record (no-hit), security freeze, deceased indicator, no score
- lookup failures and timeouts, kept apart from findings about the person
- RequestIDs for debugging

It reports facts and observations such as "the bureaus disagree". It does **not** approve or decline anyone and does **not** decide whether someone is committing fraud.

## Try it

- `Check credit for P01`
- `Check credit for P17`

Allowed personas: P01, P13, P14, P15, P17. All data comes from the CRS sandbox. No real consumer data is used.

## How it works

ASI:One chat → AgentCircuit (lead, Agent Chat Protocol) → Credit agent → CRS sandbox → back to chat.
Requests and results are matched by `task_id`.
