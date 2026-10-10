#!/usr/bin/env node
// Check the hash chain of Fenceline log files. With no arguments, checks every file in the log folder.
//   node tools/verify-log.mjs [file.jsonl ...]
import { readFileSync, readdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import { DEFAULT_LOG_DIR, verifyChain } from './event-log.mjs';

const dir = process.env.FENCELINE_LOG_DIR || DEFAULT_LOG_DIR;
let files = process.argv.slice(2);
if (!files.length) {
  try {
    files = readdirSync(dir).filter((n) => /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(n)).sort().map((n) => join(dir, n));
  } catch {
    console.error(`No log folder at ${dir}.`);
    process.exit(1);
  }
}
let bad = 0;
for (const file of files) {
  const day = basename(file).match(/^(\d{4}-\d{2}-\d{2})\.jsonl$/)?.[1];
  if (!day) { console.log(`${file}: skipped, not a daily log file`); continue; }
  const r = verifyChain(readFileSync(file, 'utf8'), day);
  if (r.ok) console.log(`${file}: OK, ${r.lines} events`);
  else { bad++; console.log(`${file}: CHANGED at line ${r.brokenAt}; that line or one before it was edited, inserted or removed`); }
}
process.exit(bad ? 1 : 0);
