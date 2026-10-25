import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const recording = JSON.parse(readFileSync(new URL("../lib/control/recorded-demo.json", import.meta.url), "utf8"));

assert.equal(recording.recordedWith, "scripts/record-demo.mjs");
assert.ok(Array.isArray(recording.runs));

const ids = new Set();
for (const run of recording.runs) {
  assert.ok(!ids.has(run.id), `duplicate run id ${run.id}`);
  ids.add(run.id);
  assert.ok(["gemini", "ollama"].includes(run.provider), `${run.id}: provider`);
  assert.ok(!Number.isNaN(Date.parse(run.recordedAt)), `${run.id}: recordedAt`);
  // Only completed workflows are published.
  assert.match(run.outcome, /^WORKFLOW COMPLETE:/, `${run.id}: outcome`);
  assert.doesNotMatch(run.outcome, /FAILED/, `${run.id}: failed outcome`);
  assert.match(run.log, /WORKFLOW COMPLETE:/, `${run.id}: log marker`);
  assert.ok(run.activity.length > 0, `${run.id}: activity`);

  // Redaction: no local paths or credential-shaped values.
  const text = JSON.stringify(run);
  assert.doesNotMatch(text, /[A-Za-z]:\\\\/, `${run.id}: Windows path`);
  assert.doesNotMatch(text, /AIza[0-9A-Za-z_-]{20,}/, `${run.id}: Google API key`);
  assert.doesNotMatch(text, /0x[0-9a-fA-F]{64}/, `${run.id}: private key`);
  assert.doesNotMatch(text, /Bearer\s+\S{8,}/, `${run.id}: bearer token`);
}

console.log(`PASS: recorded demo (${recording.runs.length} runs)`);
