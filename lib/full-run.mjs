// The default complete workflow: verify, enrich, mutate, then let the caller build the final map.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { collect, mapData, writePage } from './build.mjs';
import { enrich } from './enrich.mjs';
import { mutate, verifyTests } from './mutation-run.mjs';
import { fileHash } from './mutation.mjs';

const record = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);

function fingerprint(repository, facts, config, options) {
  const artifacts = new Set([options.out ?? config.out, options.descriptions ?? config.descriptions,
    options.labels ?? config.testLabels, options.mutation ?? config.mutation, config.coverage ?? 'coverage/lcov.info'].map(path => relative(repository, resolve(repository, path))));
  const hash = createHash('sha256');
  const add = (path, value) => hash.update(JSON.stringify([path, value]));
  add('runtime', [process.version, process.platform, process.arch]);
  add('selection', [options.worktree, config, options.file, options.function, options['max-mutants'], options.timeout, options['test-command']]);
  // Include fixtures, manifests, lockfiles and configuration, not just the files drawn on the map.
  const explicit = new Set(config.executionInputs ?? []);
  const documentation = /^(?:[^/]+\.md|docs\/.*\.md)$/i;
  const paths = [...new Set(facts.reader.list())].filter(path => !artifacts.has(path) && (!documentation.test(path) || explicit.has(path))).sort();
  for (const [path, text] of facts.reader.read(paths)) add(path, text);
  const tool = fileURLToPath(new URL('../', import.meta.url));
  for (const directory of ['bin', 'lib']) for (const name of readdirSync(resolve(tool, directory)).sort()) {
    if (/\.(mjs|html)$/.test(name)) add(`tool:${directory}/${name}`, readFileSync(resolve(tool, directory, name), 'utf8'));
  }
  add('tool:package-lock.json', readFileSync(resolve(tool, 'package-lock.json'), 'utf8'));
  return hash.digest('hex');
}

function cachedReport(path, key, coveragePath) {
  if (!existsSync(path)) return null;
  let report;
  try { report = JSON.parse(readFileSync(path, 'utf8')); } catch { return null; }
  if (!record(report) || report.tool !== 'code-map mutate' || !record(report.files) || !Array.isArray(report.units)
    || !record(report.workflow) || report.workflow.fingerprint !== key || report.workflow.complete !== true
    || !Array.isArray(report.workflow.tests) || !Array.isArray(report.workflow.skippedTests)) return null;
  if (typeof report.workflow.coverageHash === 'string' && (!existsSync(coveragePath) || fileHash(readFileSync(coveragePath, 'utf8')) !== report.workflow.coverageHash)) return null;
  return report;
}

/** No mutation budget by default: every supported mutation candidate is attempted on the first complete run. */
export async function fullRun(repository, config, options, { signal, log = () => {} } = {}) {
  const facts = collect(repository, config, options);
  const key = fingerprint(repository, facts, config, options);
  const out = resolve(repository, options.mutation ?? config.mutation);
  const coveragePath = resolve(repository, config.coverage ?? 'coverage/lcov.info');
  const cached = !options.force && cachedReport(out, key, coveragePath);
  let report;
  if (cached) { log('Code, tests and settings unchanged; reusing test and mutation results.'); report = cached; }
  else {
    const data = mapData(repository, config, facts, 2, options.worktree);
    const execution = { repository, data, testCommand: options['test-command'] ?? config.mutationTestCommand,
      timeoutMs: options.timeout ? Number(options.timeout) * 1000 : undefined, log };
    const verification = verifyTests(execution);
    if (verification.coverage !== null) writePage(coveragePath, verification.coverage);
    await enrich(facts, { signal, log });
    signal?.throwIfAborted();
    const files = options.file ?? facts.files.map(file => file.path);
    if (options.file?.some(path => !facts.files.some(file => file.path === path))) throw new Error('A selected mutation file is not a mapped source.');
    const eligible = data.analysis.tests.units.some(unit => files.includes(unit.path)
      && (!options.function?.length || options.function.includes(unit.name)) && (unit.exits.length || unit.direct.length));
    report = eligible ? mutate({ ...execution, files, functionNames: options.function ?? [],
      maxMutants: options['max-mutants'] === undefined ? Number.MAX_SAFE_INTEGER : Number(options['max-mutants']) })
      : { schemaVersion: 1, tool: 'code-map mutate', sha: data.sha, ref: data.ref, files: {}, units: [], limits: ['No eligible functions were discovered.'] };
    if (fingerprint(repository, facts, config, options) !== key) throw new Error('Repository changed during the full run; run again to verify the new snapshot.');
    const complete = !report.units.some(unit => ['partial', 'baseline-failed'].includes(unit.status) || unit.excluded?.length)
      && !Object.values(report.files).some(file => file.mutants.some(item => item.status === 'error'));
    report.workflow = { fingerprint: key, complete, tests: verification.receipts, skippedTests: verification.skipped,
      coverageHash: verification.coverage === null ? null : fileHash(verification.coverage) };
    writePage(out, JSON.stringify(report, null, 2) + '\n');
    if (!complete) throw new Error('Full run incomplete: see mutation report for partial checks, baseline failures or runner errors.');
  }
  if (cached) await enrich(facts, { signal, log });
  const counts = Object.values(report.files).flatMap(file => file.mutants).reduce((counts, item) => {
    counts[item.status] = (counts[item.status] ?? 0) + 1; return counts;
  }, {});
  const unsupported = report.units.filter(unit => ['no-runner', 'no-tests', 'not-loaded'].includes(unit.status));
  log(`Mutation results: ${JSON.stringify(counts)}; ${unsupported.length} functions without executable evidence; ${report.workflow.skippedTests.length} unsupported test files.`);
}
