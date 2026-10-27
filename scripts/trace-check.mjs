// Runs each named test of calibration/trace.json alone and checks the trace. A "pass" part needs its exact test to run
// and pass. A "gap" part needs its exact test to run as a todo, or no test and a note. An "out-of-scope" part names no test. The script prints one
// row for each capability and each problem. The exit code is 1 when a part does not hold or a capability has no part.
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const parts = JSON.parse(readFileSync(new URL('../calibration/trace.json', import.meta.url), 'utf8'));
const capabilities = Array.from({ length: 45 }, (_, index) => `C${String(index + 1).padStart(2, '0')}`);
const concurrency = 6, timeoutMs = 300000;
const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// TAP escapes a backslash and a hash in a test name.
const unescape = (text) => text.replace(/\\([\\#])/g, '$1');

function run(file, name) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['--test', '--test-reporter=tap', '--test-name-pattern', escape(name), file], { cwd: root });
    let text = '', error = null, timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, timeoutMs);
    child.stdout.on('data', (bytes) => { text += bytes; });
    child.stderr.on('data', (bytes) => { text += bytes; });
    child.on('error', (cause) => { error = cause.message; });
    child.on('close', (code, signal) => { clearTimeout(timer); resolve({ code, signal, text, error, timedOut }); });
  });
}

/** Finds the TAP line of the exact test name. A suite line and the lines of other tests do not count. */
function outcome(text, name) {
  for (const line of text.split('\n')) {
    const match = /^\s*(not )?ok \d+ - (.*?)(?: # (SKIP|TODO)\b.*)?$/.exec(line);
    if (match && unescape(match[2]) === name) return { found: true, ok: !match[1], directive: match[3] ?? null };
  }
  return { found: false };
}

async function check(part) {
  if (part.status === 'out-of-scope') return part.test ? 'an out-of-scope part names a test' : null;
  if (!['pass', 'gap'].includes(part.status)) return `unknown status "${part.status}"`;
  // A gap that a review found before any code exists names no test. Its note says what is missing.
  if (part.status === 'gap' && !part.test) return part.note ? null : 'a gap without a test needs a note';
  if (typeof part.file !== 'string' || typeof part.test !== 'string' || !part.test) return 'no file or test name';
  const execution = await run(part.file, part.test);
  if (execution.error) return `the test process could not run: ${execution.error}`;
  if (execution.timedOut) return 'the test process exceeded its time limit';
  if (execution.signal) return `the test process ended with signal ${execution.signal}`;
  if (execution.code !== 0) return `the test process exited with code ${execution.code}`;
  const result = outcome(execution.text, part.test);
  if (!result.found) return 'the exact test did not run';
  if (part.status === 'gap') return result.directive === 'TODO' ? null : 'a gap test is not marked todo';
  if (result.directive) return `the test is ${result.directive}`;
  return result.ok ? null : 'the test failed';
}

const problems = new Array(parts.length);
let next = 0;
await Promise.all(Array.from({ length: concurrency }, async () => {
  while (next < parts.length) {
    const index = next++;
    problems[index] = await check(parts[index]);
    console.error(`${parts[index].id} ${problems[index] ? 'PROBLEM' : 'ok'}: ${parts[index].part}`);
  }
}));
console.log('| Capability | Parts | Pass | Gap | Out of scope | Problems |\n| --- | --- | --- | --- | --- | --- |');
for (const id of capabilities) {
  const rows = parts.map((part, index) => ({ part, problem: problems[index] })).filter((row) => row.part.id === id);
  const count = (status) => rows.filter((row) => row.part.status === status && !row.problem).length;
  console.log(`| ${id} | ${rows.length} | ${count('pass')} | ${count('gap')} | ${count('out-of-scope')} | ${rows.filter((row) => row.problem).length} |`);
}
const failed = parts.map((part, index) => ({ part, problem: problems[index] })).filter((row) => row.problem);
for (const { part, problem } of failed) console.log(`- ${part.id} "${part.part}": ${problem} (${part.file} :: ${part.test})`);
const missing = capabilities.filter((id) => !parts.some((part) => part.id === id));
for (const id of missing) console.log(`- ${id}: no part`);
process.exitCode = failed.length || missing.length ? 1 : 0;
