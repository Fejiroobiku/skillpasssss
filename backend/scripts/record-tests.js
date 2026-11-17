/**
 * Runs the whole backend test suite against the real test database and saves the run as evidence:
 *
 *   backend/test-results/<date>_<commit>/
 *     environment.json  commit, branch, whether the tree had uncommitted changes, Node, OS and PostgreSQL versions
 *     spec.txt          the human-readable run, test by test, with the coverage table at the end
 *     junit.xml         the same run in JUnit format, for CI tools
 *     summary.md        totals per test file, and the provider-failure and database checks this run covers
 *
 * Usage (from backend/):  npm run test:record
 * Commit the folder with the code it tested, so each report claim can be traced to a real run.
 */
import { spawnSync } from 'node:child_process';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const git = (...args) => spawnSync('git', args, { cwd: root, encoding: 'utf8' }).stdout.trim();

const commit = git('rev-parse', 'HEAD') || 'unknown';
const short = commit.slice(0, 7);
const dirty = git('status', '--porcelain', '--', '.', ':!test-results').length > 0;
const recordedAt = new Date().toISOString();
const outDir = path.join(root, 'test-results', `${recordedAt.slice(0, 10)}_${short}${dirty ? '-dirty' : ''}`);
await mkdir(outDir, { recursive: true });

const databaseUrl = process.env.TEST_DATABASE_URL ?? 'postgres://skillpass:skillpass@localhost:5432/skillpass_test';
let postgres = 'unavailable';
try {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  postgres = (await client.query('SHOW server_version')).rows[0].server_version;
  await client.end();
} catch (err) {
  console.error(`Could not reach the test database (${err.message}). The run will fail the database tests.`);
}

const files = (await readdir(path.join(root, 'tests'))).filter((f) => f.endsWith('.test.js')).sort().map((f) => path.join('tests', f));
const run = spawnSync(process.execPath, [
  '--test', '--test-concurrency=1', '--experimental-test-coverage',
  '--test-reporter=spec', `--test-reporter-destination=${path.join(outDir, 'spec.txt')}`,
  '--test-reporter=junit', `--test-reporter-destination=${path.join(outDir, 'junit.xml')}`,
  ...files,
], { cwd: root, encoding: 'utf8', env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1' } });

// Per-file totals. The JUnit report lists top-level describe() blocks, not files, so each block is matched to the
// test file that declares it, and its test cases are counted (nested blocks included).
const junit = await readFile(path.join(outDir, 'junit.xml'), 'utf8');
const sources = await Promise.all(files.map(async (f) => [path.basename(f), await readFile(path.join(root, f), 'utf8')]));
const unescape = (s) => s.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const fileOf = (suite) => {
  const forms = [`describe('${suite.replace(/'/g, "\\'")}'`, `describe("${suite}"`, `describe(\`${suite}\``];
  return sources.find(([, text]) => forms.some((f) => text.includes(f)))?.[0] ?? '(not matched)';
};
const perFile = new Map(files.map((f) => [path.basename(f), { tests: 0, failed: 0, skipped: 0 }]));
let current = null;
for (const line of junit.split('\n')) {
  const top = line.match(/^\t<testsuite name="([^"]*)"/);
  if (top) current = fileOf(unescape(top[1]));
  if (!current || !/<testcase /.test(line)) continue;
  const row = perFile.get(current) ?? { tests: 0, failed: 0, skipped: 0 };
  row.tests += 1;
  perFile.set(current, row);
}
// Failures and skips are counted per block from the testsuite attributes of top-level blocks.
for (const m of junit.matchAll(/^\t<testsuite name="([^"]*)"[^>]*? failures="(\d+)" skipped="(\d+)"/gm)) {
  const row = perFile.get(fileOf(unescape(m[1])));
  if (row) { row.failed += Number(m[2]); row.skipped += Number(m[3]); }
}
const total = [...perFile.values()].reduce((a, r) => ({ tests: a.tests + r.tests, failed: a.failed + r.failed, skipped: a.skipped + r.skipped }), { tests: 0, failed: 0, skipped: 0 });
const spec = await readFile(path.join(outDir, 'spec.txt'), 'utf8');
const coverage = spec.match(/all files\s*\|\s*([\d.]+)\s*\|\s*([\d.]+)\s*\|\s*([\d.]+)/);

const environment = {
  commit, branch: git('rev-parse', '--abbrev-ref', 'HEAD'), uncommittedChanges: dirty, recordedAt,
  node: process.version, os: `${os.type()} ${os.release()} (${os.arch()})`, postgres,
  database: databaseUrl.replace(/\/\/[^@]*@/, '//***@'),
  command: `node --test --test-concurrency=1 --experimental-test-coverage ${files.join(' ')}`,
  exitCode: run.status,
  totals: total,
  coverage: coverage ? { linesPct: Number(coverage[1]), branchesPct: Number(coverage[2]), functionsPct: Number(coverage[3]) } : null,
};
await writeFile(path.join(outDir, 'environment.json'), `${JSON.stringify(environment, null, 2)}\n`);

const rows = [...perFile.entries()].map(([f, r]) => `| ${f} | ${r.tests} | ${r.tests - r.failed - r.skipped} | ${r.failed} | ${r.skipped} |`).join('\n');
await writeFile(path.join(outDir, 'summary.md'), `# Backend test run ${recordedAt.slice(0, 10)} (${short}${dirty ? ', uncommitted changes' : ''})

- Commit: \`${commit}\`
- Recorded: ${recordedAt}
- Node ${process.version} on ${environment.os}
- PostgreSQL ${postgres} (a separate test database, wiped and re-seeded by each test file)
- Exit code: ${run.status} (${total.failed === 0 && run.status === 0 ? 'all tests passed' : 'FAILURES, see spec.txt'})
${coverage ? `- Coverage of backend source: ${coverage[1]}% lines, ${coverage[2]}% branches, ${coverage[3]}% functions\n` : ''}
| Test file | Tests | Passed | Failed | Skipped |
|---|---|---|---|---|
${rows}
| **Total** | **${total.tests}** | **${total.tests - total.failed - total.skipped}** | **${total.failed}** | **${total.skipped}** |

## What this run covers that a unit test cannot

- **Real database.** Every file except \`units.test.js\` and \`config.test.js\` runs the Express app against PostgreSQL ${postgres}, and checks the rows written, not only the HTTP answers.
- **Provider failures.** \`providers.test.js\` switches on the real Termii, Brevo and Paystack classes and replaces only the network. It checks what happens when each provider is unreachable or refuses: the user sees a plain message, no money is recorded for a failed checkout, a failed payout is marked failed and the administrators are told, queued SMS stay queued until the provider is back, and a failed reset email gives the same answer as an unknown address.

## What this run does not cover

- Real SMS or email delivery to a phone or inbox, and real money through Paystack: the providers are simulated at the network level.
- Physical phones and browsers other than the one Node uses. Those results are recorded by hand in \`docs/evidence/device-tests.md\`.
`);

console.log(`Saved ${path.relative(root, outDir)}: ${total.tests} tests, ${total.failed} failed, exit code ${run.status}.`);
process.exit(run.status ?? 1);
