# AgentCircuit Underwriting Gateway

![tag:finance](https://img.shields.io/badge/finance-3D8BD3)
![tag:credit](https://img.shields.io/badge/credit-3D8BD3)
![tag:hackathon](https://img.shields.io/badge/hackathon-3D8BD3)

Underwrites **CRS sandbox personas** (fake applicants) through **AgentCircuit**, a deterministic control layer for multi-agent finance workflows.

## What it does

1. Pulls TransUnion, Equifax and Experian credit reports through AgentCircuit. Every request is signed with this agent's uAgents identity; AgentCircuit enforces permissions, deduplication and a budget.
2. Asks a local LLM (Ollama, qwen3) to propose APPROVE, REVIEW or DECLINE from the bureau facts.
3. AgentCircuit's policy checks the proposal against its own copy of the CRS data and confirms or overrides it (deceased indicator -> DECLINE; freeze, missing file, low or divergent scores -> REVIEW).

## How to use

Send a chat message naming a persona: `P01`, `P13`, `P14`, `P15` or `P17`.

Example: "Underwrite applicant P13"

The reply contains the final decision, the policy reasons, the AI proposal and whether the policy overrode it.

## Limits

Sandbox personas only (no real consumer data). Costs are simulated. Runs on the team's machine, so it answers only while the demo is running.
