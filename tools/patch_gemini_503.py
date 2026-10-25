"""Apply a surgical HTTP 503 retry patch to the existing Gemini planner.

Does not modify any other AgentCircuit files, doesn't read .env.local, and
never makes network calls.
"""
import ast
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TARGET = ROOT / 'fetch_agents' / 'ai_workflow_planner.py'
PAYLOAD = ROOT / 'patch_payload' / 'gemini_plan_method.txt'
BACKUP = TARGET.with_name(TARGET.name + '.before-gemini-503.bak')

if not TARGET.is_file():
    raise SystemExit('Gemini planner not found. Nothing was modified.')
original = TARGET.read_text(encoding='utf-8')
if 'max_attempts = 3' in original and 'GEMINI | HTTP' in original:
    print('GEMINI RETRY PATCH ALREADY INSTALLED')
    raise SystemExit(0)
start = original.find('async def _gemini_plan(')
stop = original.find('\n\nasync def _ollama_plan(', start)
if start == -1 or stop == -1 or 'def validate_plan(' not in original:
    raise SystemExit('Unexpected planner version. Nothing was modified. Share the current file for a targeted fix.')
replacement = PAYLOAD.read_text(encoding='utf-8').rstrip('\n')
updated = original[:start] + replacement + original[stop:]
if 'import asyncio\n' not in updated:
    if 'import json\n' not in updated:
        raise SystemExit('Could not find import section. Nothing was modified.')
    updated = updated.replace('import json\n', 'import asyncio\nimport json\n', 1)
ast.parse(updated, filename=str(TARGET))
BACKUP.write_text(original, encoding='utf-8')
TARGET.write_text(updated, encoding='utf-8')
print('GEMINI HTTP 503 RETRY PATCH APPLIED')
print('Backup:', BACKUP)
print('Model stays configurable with GEMINI_MODEL in .env.local')
