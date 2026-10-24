// Runs the test files of each capability of the plan (calibration/capability-tests.json) and prints one row for each
// capability: its files and the counts of tests that pass and fail. The exit code is 1 when a capability has a failed test.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const { capabilities } = JSON.parse(readFileSync(new URL('../calibration/capability-tests.json', import.meta.url), 'utf8'));
const count = (text, name) => Number(new RegExp(`^ℹ ${name} (\\d+)$`, 'm').exec(text)?.[1] ?? NaN);
const rows = [];
for (const [id, files] of Object.entries(capabilities)) {
  const run = spawnSync(process.execPath, ['--test', '--test-concurrency=4', ...files], { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const text = `${run.stdout}\n${run.stderr}`;
  rows.push({ id, files: files.length, tests: count(text, 'tests'), pass: count(text, 'pass'), fail: count(text, 'fail'), skipped: count(text, 'skipped'), exit: run.status });
  console.error(`${id}: ${rows.at(-1).pass} of ${rows.at(-1).tests} pass`);
}
console.log('| Capability | Test files | Tests | Pass | Fail | Skipped |\n| --- | --- | --- | --- | --- | --- |');
for (const row of rows) console.log(`| ${row.id} | ${row.files} | ${row.tests} | ${row.pass} | ${row.fail} | ${row.skipped} |`);
process.exitCode = rows.some((row) => row.exit !== 0 || row.fail > 0 || !(row.tests > 0)) ? 1 : 0;
