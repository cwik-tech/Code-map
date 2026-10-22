// Runs a targeted mutation check in a private copy of the repository; the repository itself is never changed.
// It runs the project's own tests, so use it only on code that you trust. Each run keeps its receipt: the command, the
// tests discovered, passed and failed, and the outcome.
import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { git } from './git.mjs';
import { applyMutant, canary, fileHash, mutantsFor } from './mutation.mjs';

const skippedLayers = new Set(['e2e', 'live', 'smoke', 'performance']);
const skippedFrameworks = new Set(['playwright', 'cypress']);

/** A private copy of the mapped snapshot that shares the project's node_modules folders (read-only use). */
export function workspaceFor(repository, sha, worktree) {
  const folder = mkdtempSync(join(tmpdir(), 'code-map-mutate-'));
  if (worktree) {
    for (const path of git(repository, ['ls-files', '--cached', '--others', '--exclude-standard']).split('\n').filter(Boolean)) {
      const from = join(repository, path);
      if (!existsSync(from) || !statSync(from).isFile()) continue;
      mkdirSync(dirname(join(folder, path)), { recursive: true });
      copyFileSync(from, join(folder, path));
    }
  } else {
    const archive = join(folder, '.code-map-snapshot.tar');
    git(repository, ['archive', '--format=tar', `--output=${archive}`, sha]);
    execFileSync('tar', ['-xf', archive, '-C', folder]);
    rmSync(archive, { force: true });
  }
  // The copy has no node_modules; link the project's own, at the top and one folder down (for example ui/node_modules).
  for (const name of ['.', ...readdirSync(repository)]) {
    const modules = join(repository, name, 'node_modules');
    if (name !== 'node_modules' && existsSync(modules) && !existsSync(join(folder, name, 'node_modules')) && existsSync(join(folder, name))) symlinkSync(modules, join(folder, name, 'node_modules'));
  }
  return folder;
}

/** The project's own runner for these test files, with a machine-readable result: TAP for node:test, JSON for Vitest and Jest. */
export function commandFor(framework, files, folder, custom) {
  const report = join(folder, '.code-map-test-result.json');
  if (custom) {
    const argv = custom.trim().split(/\s+/).flatMap((part) => (part === '{files}' ? files : [part]));
    return { argv, parse: argv.includes('--test-reporter=tap') ? 'tap' : 'exit', report };
  }
  const bin = (name) => join(folder, 'node_modules', '.bin', name);
  if (framework === 'vitest') return { argv: [bin('vitest'), 'run', '--reporter=json', `--outputFile=${report}`, ...files], parse: 'json', report };
  if (framework === 'jest') return { argv: [bin('jest'), '--json', `--outputFile=${report}`, ...files], parse: 'json', report };
  if (framework === 'node:test' || framework === 'unknown') {
    const typescript = files.some((path) => /\.[cm]?tsx?$/.test(path)) && existsSync(join(folder, 'node_modules', 'tsx'));
    return { argv: [process.execPath, ...(typescript ? ['--import', 'tsx'] : []), '--test', '--test-reporter=tap', ...files], parse: 'tap', report };
  }
  return null;
}

/** Tests discovered, passed and failed, and files that could not load (an import, compile or discovery failure). */
export function parseResult(kind, stdout, report) {
  if (kind === 'tap') {
    const count = (name) => Number((stdout.match(new RegExp(`^# ${name} (\\d+)$`, 'm')) ?? [])[1] ?? NaN);
    const failed = [], fileErrors = [];
    // node --test reports a test file that cannot load as a failing entry named after the file, with ERR_TEST_FAILURE.
    for (const match of stdout.matchAll(/^(\s*)not ok \d+ - (.*)\n((?:\1  .*\n)*)/gm)) (/ERR_TEST_FAILURE/.test(match[3]) && /exitCode:/.test(match[3]) ? fileErrors : failed).push(match[2]);
    const tests = count('tests');
    return Number.isNaN(tests) ? null : { discovered: tests - fileErrors.length, passed: count('pass'), failed, fileErrors };
  }
  if (kind === 'json') {
    if (!existsSync(report)) return null;
    const result = JSON.parse(readFileSync(report, 'utf8'));
    const fileErrors = (result.testResults ?? []).filter((file) => file.status === 'failed' && !(file.assertionResults ?? []).length).map((file) => file.name);
    const failed = (result.testResults ?? []).flatMap((file) => (file.assertionResults ?? []).filter((test) => test.status === 'failed').map((test) => test.fullName ?? test.title));
    return { discovered: result.numTotalTests ?? 0, passed: result.numPassedTests ?? 0, failed, fileErrors };
  }
  return null;
}

function run(command, folder, timeoutMs) {
  rmSync(command.report, { force: true });
  const env = { ...process.env, CI: '1', NO_COLOR: '1', FORCE_COLOR: '0' };
  delete env.NODE_TEST_CONTEXT; // inside another node --test run, a child run reports to the parent instead of printing TAP
  const started = Date.now();
  const child = spawnSync(command.argv[0], command.argv.slice(1), { cwd: folder, env, encoding: 'utf8', timeout: timeoutMs, maxBuffer: 256 * 1024 * 1024 });
  const timedOut = child.error?.code === 'ETIMEDOUT' || child.signal === 'SIGTERM';
  return { status: child.status, timedOut, durationMs: Date.now() - started, result: timedOut ? null : parseResult(command.parse, child.stdout ?? '', command.report) };
}

/** Verify every supported discovered test file in a private snapshot before the full workflow mutates anything. */
export function verifyTests({ repository, data, testCommand, timeoutMs = 300000, log = () => {} }) {
  const folder = workspaceFor(repository, data.sha, data.coverageSnapshot === 'working-tree');
  try {
    const groups = new Map(), skipped = [];
    for (const file of data.analysis.tests.testFiles) {
      if (file.kind !== 'tests') continue;
      if (skippedLayers.has(file.type) || skippedFrameworks.has(file.framework) || !commandFor(file.framework, [file.path], folder, testCommand)) {
        skipped.push(file.path); continue;
      }
      groups.set(file.framework, [...(groups.get(file.framework) ?? []), file.path]);
    }
    const receipts = [];
    let coverage = null;
    for (const [framework, paths] of groups) {
      log(`Verifying ${paths.length} ${framework} test files.`);
      const command = commandFor(framework, paths, folder, testCommand);
      const lcov = join(folder, '.code-map-full-coverage.info');
      if (framework === 'node:test' && !testCommand) command.argv.splice(1, 0, '--experimental-test-coverage',
        '--test-reporter=lcov', `--test-reporter-destination=${lcov}`, '--test-reporter-destination=stdout');
      const result = run(command, folder, timeoutMs);
      if (result.timedOut || result.status !== 0 || !result.result || result.result.failed.length || result.result.fileErrors.length || !result.result.discovered) {
        throw new Error(`Tests failed (${framework}): ${result.timedOut ? 'timeout' : result.result?.failed.join(', ') || result.result?.fileErrors.join(', ') || 'no readable passing test result'}`);
      }
      receipts.push({ framework, files: paths, durationMs: result.durationMs, ...result.result });
      if (existsSync(lcov)) coverage = readFileSync(lcov, 'utf8').replaceAll(`SF:${folder}/`, 'SF:');
    }
    return { receipts, skipped, coverage };
  } finally { rmSync(folder, { recursive: true, force: true }); }
}

/**
 * The outcome of one mutant against the baseline: detected (a discovered test failed), survived (the same tests ran and
 * passed), timeout, or error (a file failed to load, fewer tests ran, or the runner failed without a failing test).
 */
export function outcome(runs, baselines) {
  if (runs.some((item) => item.timedOut)) return { status: 'timeout' };
  const killedBy = [];
  for (const [index, item] of runs.entries()) {
    const base = baselines[index].result;
    if (!item.result) { if (item.status !== 0) return { status: 'error', detail: 'no readable test result' }; continue; }
    if (item.result.fileErrors.length || item.result.discovered < base.discovered) return { status: 'error', detail: `test files failed to load: ${item.result.fileErrors.slice(0, 3).join(', ') || 'fewer tests discovered'}` };
    killedBy.push(...item.result.failed);
    if (!item.result.failed.length && item.status !== 0) return { status: 'error', detail: 'the runner failed without a failing test' };
  }
  return killedBy.length ? { status: 'detected', killedBy: killedBy.slice(0, 5) } : { status: 'survived' };
}

/** Test files that reach a function and that the check can run: not e2e, live or browser tests. */
export function testsFor(unit, analysis) {
  const tests = analysis.tests, byPath = new Map(tests.testFiles.map((file) => [file.path, file]));
  const fileTests = analysis.files.find((file) => file.path === unit.path)?.tests.direct ?? [];
  const paths = new Set([...unit.direct, ...unit.viaCases.map((item) => item.id)].map((id) => tests.cases[id].path).concat(fileTests));
  return [...paths].map((path) => byPath.get(path)).filter((file) => file && file.kind === 'tests' && !skippedLayers.has(file.type) && !skippedFrameworks.has(file.framework));
}

/** Runs the check for the selected functions and returns the report. `log` receives one line per step. */
export function mutate({ repository, data, files, functionNames = [], testCommand, maxMutants = 25, timeoutMs, log = () => {} }) {
  const units = data.analysis.tests.units.filter((unit) => files.includes(unit.path) && (!functionNames.length || functionNames.includes(unit.name)) && (unit.exits.length || unit.direct.length));
  if (!units.length) throw new Error(`No function with failure exits or tests in ${files.join(', ')}${functionNames.length ? ` named ${functionNames.join(', ')}` : ''}`);
  const folder = workspaceFor(repository, data.sha, data.coverageSnapshot === 'working-tree');
  const report = { schemaVersion: 1, tool: 'code-map mutate', generatedAt: new Date().toISOString(), project: data.project, ref: data.ref, sha: data.sha,
    workingTree: data.coverageSnapshot === 'working-tree', files: {}, units: [],
    limits: ['A surviving mutant means that the selected tests did not detect this change. It does not prove that the code never ran: the change can be equivalent, or the assertions too weak.',
      'Only failure exits and return values of the selected functions are mutated, and only tests that reach them through imports run.',
      'The tests run in a private copy with the project\'s own node_modules. A test can still write outside the copy.'] };
  let budget = maxMutants;
  try {
    for (const unit of units) {
      const text = readFileSync(join(folder, unit.path), 'utf8');
      report.files[unit.path] ??= { hash: fileHash(text), mutants: [] };
      const entry = { key: unit.key, tests: [], commands: [], baseline: null, canary: null, status: 'checked' };
      report.units.push(entry);
      const reached = testsFor(unit, data.analysis);
      if (reached.some((file) => !commandFor(file.framework, [file.path], folder, testCommand))) { entry.status = 'no-runner'; log(`${unit.key}: no runner`); continue; }
      // Each test file needs its own passing baseline. A file that fails without a mutant is excluded and recorded, so a
      // failure during a mutant run can only come from the mutant.
      entry.excluded = [];
      const selected = reached.filter((file) => {
        const alone = run(commandFor(file.framework, [file.path], folder, testCommand), folder, timeoutMs ?? 300000);
        const passed = alone.status === 0 && alone.result && !alone.result.failed.length && !alone.result.fileErrors.length && alone.result.discovered > 0;
        if (!passed) entry.excluded.push({ path: file.path, failed: alone.result?.failed.slice(0, 3) ?? [], fileErrors: alone.result?.fileErrors ?? [], timedOut: alone.timedOut });
        return passed;
      });
      const byFramework = new Map();
      for (const file of selected) byFramework.set(file.framework, [...(byFramework.get(file.framework) ?? []), file.path]);
      const groups = [...byFramework].map(([framework, paths]) => commandFor(framework, paths, folder, testCommand));
      entry.tests = selected.map((file) => file.path);
      entry.commands = groups.map((command) => command.argv.map((part) => part.replace(folder + '/', '')).join(' '));
      if (!selected.length) { entry.status = reached.length ? 'baseline-failed' : 'no-tests'; log(`${unit.key}: ${entry.status}`); continue; }
      const baselines = groups.map((command) => run(command, folder, timeoutMs ?? 300000));
      entry.baseline = baselines.map((item) => ({ status: item.status, durationMs: item.durationMs, ...item.result }));
      if (baselines.some((item) => item.status !== 0 || !item.result || item.result.failed.length || item.result.fileErrors.length || !item.result.discovered)) {
        entry.status = 'baseline-failed'; log(`${unit.key}: the selected tests do not pass without a mutant`); continue;
      }
      const limit = timeoutMs ?? Math.max(10000, 3 * Math.max(...baselines.map((item) => item.durationMs)) + 5000);
      const check = (mutatedText) => { writeFileSync(join(folder, unit.path), mutatedText); try { return outcome(groups.map((command) => run(command, folder, limit)), baselines); } finally { writeFileSync(join(folder, unit.path), text); } };
      entry.canary = check(canary(unit.path, text)).status;
      if (entry.canary === 'survived') { entry.status = 'not-loaded'; log(`${unit.key}: the selected tests do not load the copied file`); continue; }
      for (const mutant of mutantsFor(unit.path, text, [unit.name])) {
        if (budget <= 0) { entry.status = 'partial'; break; }
        const { start, end, valid, ...kept } = mutant;
        const result = valid ? check(applyMutant(text, mutant)) : { status: 'invalid' };
        if (valid) budget--;
        report.files[unit.path].mutants.push({ ...kept, ...result });
        log(`${unit.path}:${mutant.line} ${mutant.kind}: ${result.status}`);
      }
    }
  } finally { rmSync(folder, { recursive: true, force: true }); }
  return report;
}
