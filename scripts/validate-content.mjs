/**
 * Validates public/content.json against content.schema.json and prints
 * friendly, per-field errors. Runs in `npm run build` (and CI) so broken
 * content can never ship.
 *
 * This check uses full Ajv directly (dev-only) — intentionally independent
 * of the generated browser validator, so it also guards the generator itself.
 *
 * Run: npm run validate:content
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const schemaPath = path.join(root, 'content.schema.json');
const contentPath = path.join(root, 'public', 'content.json');

const { default: Ajv2020 } = await import('ajv/dist/2020.js');
const { default: addFormats } = await import('ajv-formats');

let schema;
let content;
try {
  schema = JSON.parse(await readFile(schemaPath, 'utf8'));
} catch (err) {
  console.error(`✖ content.schema.json is not valid JSON: ${err.message}`);
  process.exit(1);
}
try {
  content = JSON.parse(await readFile(contentPath, 'utf8'));
} catch (err) {
  console.error(`✖ public/content.json is not valid JSON: ${err.message}`);
  console.error('  Fix the syntax (missing comma, quote, or brace) and re-run.');
  process.exit(1);
}

const ajv = new Ajv2020({ strict: true, allErrors: true, allowUnionTypes: true });
addFormats(ajv);

const validate = ajv.compile(schema);
const errors = [];

if (!validate(content)) {
  for (const err of validate.errors ?? []) {
    const where = err.instancePath || '(root)';
    const allowed = err.params?.allowedValues
      ? ` — allowed: ${err.params.allowedValues.map((v) => (v === null ? 'null' : JSON.stringify(v))).join(', ')}`
      : '';
    errors.push(`${where} — ${err.message}${allowed}`);
  }
}

// Semantic checks the schema cannot express (JSON Schema uniqueItems only
// catches identical objects, not repeated ids).
const ids = (content.sections ?? []).map((s) => s.id);
const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
if (dupes.length) errors.push(`/sections — duplicate section id(s): ${[...new Set(dupes)].join(', ')}`);

if (errors.length) {
  console.error(`✖ public/content.json is invalid (${errors.length} problem${errors.length > 1 ? 's' : ''}):`);
  errors.forEach((e, i) => console.error(`  ${i + 1}. ${e}`));
  process.exit(1);
}

console.log(
  `✓ public/content.json valid — schemaVersion ${content.meta.schemaVersion}, ` +
    `${ids.length} sections, lastUpdated ${content.meta.lastUpdated}`,
);
