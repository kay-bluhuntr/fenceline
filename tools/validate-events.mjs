#!/usr/bin/env node
// Validates .jsonl event files against schema/event.schema.json.
// Usage: node tools/validate-events.mjs examples/*.jsonl
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const schema = JSON.parse(await readFile(join(root, 'schema', 'event.schema.json'), 'utf8'));
const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);
const validate = ajv.compile(schema);

const files = process.argv.slice(2);
if (!files.length) { console.error('Usage: validate-events.mjs <file.jsonl> [...]'); process.exit(2); }

let bad = 0, total = 0;
for (const file of files) {
  const lines = (await readFile(file, 'utf8')).split(/\r?\n/);
  lines.forEach((line, i) => {
    if (!line.trim()) return;
    total++;
    let obj;
    try { obj = JSON.parse(line); } catch (e) { bad++; console.error(`${file}:${i + 1}  not valid JSON: ${e.message}`); return; }
    if (!validate(obj)) {
      bad++;
      for (const err of validate.errors) console.error(`${file}:${i + 1}  ${err.instancePath || '(root)'} ${err.message}`);
    }
  });
}
console.log(`${total - bad}/${total} events valid across ${files.length} file(s)`);
process.exit(bad ? 1 : 0);
