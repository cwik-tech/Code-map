// The user model command runs outside the project worker. Its output remains model hypotheses.
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { validateHypotheses, hypothesisLimits, groundHypotheses, resultEvidence } from './hypotheses.mjs';
import { readRun, verificationContext } from './verify-context.mjs';
import { verificationRoot } from './verify.mjs';
import { storeLocation, writePrivateFile } from './store.mjs';
import { commandProblem } from './worker/command.mjs';

/** Executes user command words without a shell. Bounds combined stdout and stderr, and kills the process group on POSIX. */
export function modelOutput(words, context, { cwd, milliseconds, signal } = {}) {
  const problem = commandProblem(words);
  if (problem) throw new Error(problem);
  if (!Number.isSafeInteger(milliseconds) || milliseconds < 1 || milliseconds > 600000) throw new Error('Invalid model time limit.');
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(new Error('Model command aborted.')); return; }
    const child = spawn(words[0], words.slice(1), { cwd, shell: false, detached: process.platform !== 'win32', stdio: ['pipe', 'pipe', 'pipe'] });
    const chunks = []; let size = 0, failure = null;
    const stop = (error) => {
      if (failure) return;
      failure = error;
      try { if (process.platform === 'win32') child.kill('SIGKILL'); else if (child.pid) process.kill(-child.pid, 'SIGKILL'); }
      // ESRCH: the group is gone. EPERM: on macOS, a group that only holds the exited, not yet reaped model process refuses
      // the signal. Code-map started this group itself, so neither code leaves a live member that it could stop.
      catch (cause) { if (cause.code !== 'ESRCH' && cause.code !== 'EPERM') failure = new Error('Cannot stop model command.', { cause }); }
      // A detached descendant can retain these descriptors after the model process exits.
      child.stdin.destroy(); child.stdout.destroy(); child.stderr.destroy();
    };
    const timer = setTimeout(() => stop(new Error('Model command exceeded its time limit.')), milliseconds);
    const abort = () => stop(new Error('Model command aborted.'));
    signal?.addEventListener('abort', abort, { once: true });
    const receive = (bytes, stdout) => {
      size += bytes.length;
      if (size > hypothesisLimits.bytes) stop(new Error('Model command exceeded its output limit of 256 KiB.'));
      else if (stdout) chunks.push(bytes);
    };
    child.stdout.on('data', (bytes) => receive(bytes, true));
    child.stderr.on('data', (bytes) => receive(bytes, false));
    child.stdin.on('error', (error) => { if (error.code !== 'EPIPE') stop(new Error('Cannot send model context.', { cause: error })); });
    child.on('error', (error) => { failure = new Error('Cannot start model command.', { cause: error }); });
    child.on('close', (code, killedBy) => {
      clearTimeout(timer); signal?.removeEventListener('abort', abort);
      if (failure) reject(failure);
      else if (code !== 0) reject(new Error(`Model command exit ${code ?? killedBy}.`));
      else resolve(Buffer.concat(chunks).toString('utf8'));
    });
    child.stdin.end(JSON.stringify(context, null, 2) + '\n');
  });
}

/** Reads a finished run, validates model output, and atomically saves only the validated hypotheses file. */
export async function reviewRun(repository, options, words, { env = process.env, signal } = {}) {
  const allowed = new Set(['run', 'out-dir', 'store', 'compact', 'wall-clock-seconds']);
  const extra = Object.entries(options).filter(([key, value]) => !allowed.has(key) && value !== false && value !== undefined && !(key === 'port' && value === '4477'));
  if (extra.length) throw new Error(`Unsupported review options: ${extra.map(([key]) => `--${key}`).join(', ')}.`);
  const seconds = options['wall-clock-seconds'] ?? '60';
  if (!/^[1-9]\d*$/.test(seconds) || Number(seconds) > 600) throw new Error('Review --wall-clock-seconds must be 1 to 600.');
  const root = verificationRoot(repository, options, storeLocation(options.store, env)), results = readRun(root, options.run);
  const output = await modelOutput(words, verificationContext(results), { cwd: repository, milliseconds: Number(seconds) * 1000, signal });
  let value;
  try { value = JSON.parse(output); } catch (cause) { throw new Error('Model output is not valid JSON.', { cause }); }
  const checked = validateHypotheses(value);
  if (!checked.ok) throw new Error(`Invalid model hypotheses: ${checked.errors.slice(0, 20).map((x) => `${x.path}: ${x.message}`).join(' ')}`);
  const known = resultEvidence(results, { paths: results.change?.paths ?? [], criteria: results.request?.acceptanceCriteria ?? [],
    caseIds: Object.values(results.provenance?.cases ?? {}).flat().map((x) => x.evidenceId) });
  const { file } = groundHypotheses({ items: checked.hypotheses.items }, known);
  // Recheck folder ownership before writing. Existing reports, results and latest.json stay byte-identical.
  readRun(root, options.run);
  const path = join(root, 'runs', options.run, 'review-hypotheses.json');
  writePrivateFile(path, JSON.stringify(checked.hypotheses, null, 2) + '\n');
  return { reportType: 'code-map-model-review', runId: options.run, path, model: checked.hypotheses.model,
    total: file.total, grounded: file.grounded, ungrounded: file.ungrounded, label: 'model output, not evidence' };
}
