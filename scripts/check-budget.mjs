/**
 * Public JS budget gate — gzip size of every NON-admin chunk in dist must
 * stay under 50 KB (the brief's hard budget). The edit-mode chunk is
 * code-split (named "admin-*" via vite.config manualChunks) and excluded.
 *
 *   node scripts/check-budget.mjs
 */
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

const BUDGET_BYTES = 50 * 1024;
const assetsDir = join(process.cwd(), 'dist', 'assets');

let names;
try {
  names = await readdir(assetsDir);
} catch {
  console.error('check-budget: dist/assets not found — run the build first.');
  process.exit(1);
}

const jsFiles = names.filter((n) => n.endsWith('.js')).sort();
let total = 0;

for (const name of jsFiles) {
  const raw = await readFile(join(assetsDir, name));
  const gz = gzipSync(raw, { level: 9 }).length;
  const isEditor = /^admin[-.]/.test(name);
  if (!isEditor) total += gz;
  console.log(
    `  ${isEditor ? '[editor, excluded] ' : ''}${name}: ${(raw.length / 1024).toFixed(2)} KB raw → ${(gz / 1024).toFixed(2)} KB gz`,
  );
}

const budgetKb = BUDGET_BYTES / 1024;
console.log(`\nPublic JS total: ${(total / 1024).toFixed(2)} KB gz / budget ${budgetKb} KB`);

if (total >= BUDGET_BYTES) {
  console.error(`✗ public JS budget exceeded (${total} >= ${BUDGET_BYTES} bytes)`);
  process.exit(1);
}
console.log('✓ within budget');
