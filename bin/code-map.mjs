#!/usr/bin/env node
import { buildSbom } from '../lib/supply/sbom.mjs';
import { reviewRun } from '../lib/model-review.mjs';
import { keySummary } from '../lib/worker/signing.mjs';
import { storeLocation } from '../lib/store.mjs';
import { recordWeakening } from '../lib/weakening-command.mjs';
import { recordOracle } from '../lib/oracle-command.mjs';
import { mutateWork } from '../lib/mutation/cli.mjs';
// code-map: a zoomable map of a codebase. Run it inside any Git repository.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { help } from '../lib/cli-help.mjs';
import { collect, mapData, renderPage, writePage } from '../lib/build.mjs';
import { createReport } from '../lib/analysis.mjs';
import { retrieveTrace as retrieve } from '../lib/models/trace-inspect.mjs';
import { protectedFolderOf, isRetrieval } from '../lib/inspect.mjs';
import { stampDescriptions, todoReport } from '../lib/descriptions.mjs';
import { labelsTodo, stampTestLabels } from '../lib/test-labels.mjs';
import { summarizeTests } from '../lib/test-summary.mjs';
import { runContext, runVerify, verifySummary } from '../lib/verify.mjs';
import { withUnsplitIndex } from '../lib/verify-change.mjs';
import { writePrivateFile } from '../lib/store.mjs';
import { calendarDate } from '../lib/triage.mjs';
import { triageFinding } from '../lib/triage-command.mjs';
import { readSizes } from '../lib/sizes.mjs';
import { harnessWork } from '../lib/harness/run.mjs';
import { authorizeWork, runWork, benchWork } from '../lib/worker/cli.mjs';
import { buildManifest } from '../lib/manifest.mjs';
import { git, repositoryRoot } from '../lib/git.mjs';
import { defaults, loadConfig } from '../lib/project.mjs';
import { startServer } from '../lib/server.mjs';
import { chatWorkspace } from '../lib/snapshot.mjs';


const spec = {
  'print-selection': { type: 'boolean', default: false },
  install: { type: 'string' }, 'npm-cache': { type: 'string' },
  run: { type: 'string' }, runs: { type: 'string' }, warmup: { type: 'string' },
  'trace-xstate': { type: 'boolean', default: false },
  entry: { type: 'string' }, 'reviewed-by': { type: 'string' },
  types: { type: 'boolean', default: false },
  'compiler-report': { type: 'string' }, 'base-compiler-report': { type: 'string' },
  case: { type: 'string' }, criterion: { type: 'string' }, method: { type: 'string' }, 'confirmed-by': { type: 'string' },
  max: { type: 'string' }, seed: { type: 'string' },
  dir: { type: 'string' }, ref: { type: 'string' }, worktree: { type: 'boolean', default: false }, out: { type: 'string' },
  json: { type: 'boolean', default: false }, file: { type: 'string', multiple: true }, change: { type: 'string' },
  'exclude-vendors': { type: 'boolean', default: false },
  descriptions: { type: 'string' }, labels: { type: 'string' }, history: { type: 'string' }, todo: { type: 'boolean', default: false },
  stamp: { type: 'boolean', default: false }, 'stamp-all': { type: 'boolean', default: false },
  serve: { type: 'boolean', default: false }, port: { type: 'string', default: '4477' }, help: { type: 'boolean', short: 'h', default: false },
  summary: { type: 'boolean', default: false }, analysis: { type: 'string' }, finding: { type: 'string' }, findings: { type: 'boolean', default: false },
  rule: { type: 'string' }, part: { type: 'string' }, offset: { type: 'string' }, limit: { type: 'string' }, full: { type: 'boolean', default: false },
  store: { type: 'string' }, compact: { type: 'boolean', default: false }, request: { type: 'string' }, 'out-dir': { type: 'string' }, context: { type: 'string' },
  base: { type: 'string' }, 'base-analysis': { type: 'string' }, baseline: { type: 'string' }, complexity: { type: 'boolean', default: false }, dependencies: { type: 'boolean', default: false }, api: { type: 'string' }, 'api-group': { type: 'string' },
  impact: { type: 'string' }, undocumented: { type: 'boolean', default: false },
  'include-hidden': { type: 'boolean', default: false }, unlabeled: { type: 'boolean', default: false }, 'no-cache': { type: 'boolean', default: false },
  state: { type: 'string' }, reason: { type: 'string' }, owner: { type: 'string' }, expires: { type: 'string' },
  schemas: { type: 'boolean', default: false },
  artifact: { type: 'string' }, kind: { type: 'string' }, 'exit-status': { type: 'string' }, discovery: { type: 'string' }, filter: { type: 'string', multiple: true },
  trust: { type: 'string' }, spec: { type: 'string' }, authorization: { type: 'string' }, head: { type: 'string' }, 'expires-days': { type: 'string' }, 'wall-clock-seconds': { type: 'string' },
  'disk-megabytes': { type: 'string' }, 'memory-megabytes': { type: 'string' }, 'output-megabytes': { type: 'string' }, concurrency: { type: 'string' },
};
// Command tails contain program options. The parser must not interpret these words.
const argv = process.argv.slice(2);
const tail = ['--command', '--model-command'].map((flag) => ({ flag, index: argv.indexOf(flag) })).filter((x) => x.index >= 0).sort((a, b) => a.index - b.index)[0];
const prefix = tail ? parseArgs({ args: argv.slice(0, tail.index), allowPositionals: true, strict: false, options: spec }).positionals[0] : null;
const at = tail && ((tail.flag === '--command' && prefix === 'authorize') || (tail.flag === '--model-command' && prefix === 'review')) ? tail.index : -1;
const args = at < 0 ? argv : argv.slice(0, at), commandWords = at < 0 ? null : argv.slice(argv[at + 1] === '--' ? at + 2 : at + 1);
const runWords = args.includes('--') ? args.slice(args.indexOf('--') + 1) : [];
let parsed;
try { parsed = parseArgs({ args, allowPositionals: true, options: spec }); } catch (error) {
  // verify exits with 4 for an invalid request, because 1 means REVIEW there. The command is the first word that is not an
  // option or an option value, so the other commands keep exit 1 when a file or a ref has the name "verify".
  const first = parseArgs({ args, allowPositionals: true, strict: false, options: spec }).positionals[0];
  process.stderr.write(`code-map: ${error instanceof Error ? error.message : String(error)}\n`); process.exit(first === 'verify' ? 4 : 1);
}
const { values: options, positionals } = parsed;
const failure = positionals[0] === 'verify' ? 4 : 1;
if (options.help) { process.stdout.write(help); process.exit(0); }
// A stored analysis names its own repository and reads its own configuration, so `inspect --analysis` also works outside
// a repository, and it does not read the .code-map.json of the current folder.
const storedOnly = positionals[0] === 'inspect' && options.analysis !== undefined;
let repository = null;
try { repository = repositoryRoot(process.cwd()); } catch {
  if (!storedOnly && positionals[0] !== 'key') { process.stderr.write('code-map needs to run inside a Git repository.\n'); process.exit(failure); }
}
let config = null;
if (repository !== null && !storedOnly) {
  try { config = loadConfig(repository); } catch (error) {
    process.stderr.write(`code-map: Cannot use ${join(repository, '.code-map.json')}: ${error instanceof Error ? error.message : String(error)}\n`); process.exit(failure);
  }
}
const command = positionals[0];
if (command === 'serve') options.serve = true;
else if (command === 'todo') options.todo = true;
else if (command === 'stamp') options.stamp = true;
else if (command === 'stamp-all') options['stamp-all'] = true;
else if (command === 'help') { process.stdout.write(help); process.exit(0); }
// The decision options belong to `code-map triage`. Another command would ignore them, so they fail, as an unknown option does.
// verify refuses them with its own message and exit code.
const triageOnly = ['state', ...(command === 'review-weakening' ? [] : ['reason']), 'owner', 'expires'].filter((name) => options[name] !== undefined);
if (triageOnly.length && command !== 'triage' && command !== 'verify') {
  process.stderr.write(`code-map: ${triageOnly.map((name) => `--${name}`).join(', ')} only work with code-map triage.\n`); process.exit(1);
}
if (command === 'key') await workerWork(() => {
  const extra = Object.entries(options).filter(([name, value]) => !['store', 'compact'].includes(name) && value !== undefined && value !== false && !(name === 'port' && value === '4477'));
  if (extra.length || positionals.length !== 1) throw new Error('key takes only --store and --compact.');
  const { root } = storeLocation(options.store);
  if (repository && protectedFolderOf(repository, root) !== null) throw new Error('The key store must be outside the repository and its Git folders.');
  return keySummary(root);
});
else if (command === 'init') init();
else if (command === 'harness') await workerWork(async () => { const result = await harnessWork(repository, config, options, positionals); process.exitCode = result.exitCode; return result.summary; });
else if (command === 'verify') await verify();
else if (command === 'sbom') {
  try {
    if (positionals.length !== 1 || !options.out) throw new Error('sbom needs --out <file> and no other words.');
    emit(buildSbom(collect(repository, config, options).supply), true);
  } catch (error) { process.stderr.write(`code-map: ${error.message}\n`); process.exitCode = 1; }
}
else if (command === 'review') await workerWork(() => {
  if (positionals.length !== 1) throw new Error('review takes no positional words.');
  return reviewRun(repository, options, commandWords);
});
else if (command === 'sizes') {
  try {
    if (positionals.length !== 1) throw new Error('sizes takes no other words.');
    if (!options.out) throw new Error('sizes needs --out <file>.');
    emit(readSizes(resolve(repository, options.dir ?? '.next')), true);
  } catch (error) { process.stderr.write(`code-map: ${error.message}\n`); process.exitCode = 1; }
}
else if (command === 'manifest') manifestWork(positionals.slice(1));
else if (command === 'review-weakening') await workerWork(() => withUnsplitIndex(repository, () => recordWeakening(repository, config, options, { today: calendarDate(new Date()), words: positionals.slice(1) })));
else if (command === 'oracle') await workerWork(() => recordOracle(repository, config, options, { today: calendarDate(new Date()), words: positionals.slice(1) }));
else if (command === 'triage') triageWork(positionals.slice(1));
else if (command === 'authorize') workerWork(() => authorizeWork(repository, options, positionals, commandWords));
// run reads Git only before it starts the command, so the unsplit copy of the index covers each Git read of the run.
else if (command === 'bench') await workerWork(async () => {
  const result = await withUnsplitIndex(repository, () => benchWork(repository, config, options, positionals, runWords));
  process.exitCode = result.exitCode;
  return result.summary;
});
else if (command === 'run') await workerWork(async () => {
  const result = await withUnsplitIndex(repository, () => runWork(repository, config, options, positionals, runWords));
  process.exitCode = result.exitCode;
  return result.summary;
});
else if (command === 'mutate') await workerWork(() => withUnsplitIndex(repository, () => mutateWork(repository, config, options, positionals, runWords)));
else if (command === 'labels' && positionals.length <= 2) labelsWork(positionals[1]);
else if (positionals.length > 1 || (command && !['serve', 'todo', 'stamp', 'stamp-all', 'inspect'].includes(command))) {
  process.stderr.write(`Unknown command: ${positionals.join(' ')}\n\n${help}`); process.exit(1);
}
else if (command === 'inspect' || options.json) {
  try { if (isRetrieval(options) || options.run !== undefined) emit(retrieve(repository, config, options, process.env, calendarDate(new Date())), true); else inspect(); }
  catch (error) { process.stderr.write(`code-map: ${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 1; }
}
else if (options.todo || options.stamp || options['stamp-all']) descriptionsWork();
else if (options.serve) await serve();
else build();
function build() {
  const facts = collect(repository, config, options);
  const data = mapData(repository, config, facts, Number(options.history ?? config.history), options.worktree);
  const out = resolve(repository, options.out ?? config.out);
  writePage(out, renderPage(data, null));
  const missing = data.files.filter((file) => file.status === 'missing').length;
  const stale = data.files.filter((file) => file.status === 'stale').length;
  process.stdout.write(`Code map of ${data.project} · ${data.ref} (${data.sha.slice(0, 7)}): ${data.files.length} files in `
    + `${data.roots.join(', ')}, ${data.history.snapshots.length} snapshots, ${missing} undescribed, ${stale} stale\n`
    + `  -> ${relative(process.cwd(), out) || out}\n`);
  return { data, out };
}
function inspect() {
  const facts = collect(repository, config, options);
  const data = mapData(repository, config, facts, Number(options.history ?? config.history), options.worktree);
  emit(createReport(data, { files: options.file ?? [], change: options.change, includeVendors: !options['exclude-vendors'] }, summarizeTests));
}
/**
 * Exits with the code of the readiness state: 0 READY, 1 REVIEW, 2 BLOCKED, 3 INSUFFICIENT_EVIDENCE, and 4 for an invalid request or a failure.
 * With --context, it prints the context of a finished run and exits with 0, or with 4 for a failure.
 */
async function verify() {
  const allowed = new Set(['request', 'store', 'out-dir', 'compact', 'context', 'no-cache', 'install', 'npm-cache']);
  const extra = Object.entries(options).filter(([name, value]) => !allowed.has(name) && value !== undefined && value !== false && !(name === 'port' && value === '4477'));
  try {
    if (positionals.length > 1) throw new Error(`verify takes no other words: ${positionals.slice(1).join(' ')}.`);
    if (extra.length) throw new Error(`verify takes only --request or --context, --store, --out-dir, --no-cache, --compact, --install and --npm-cache, not ${extra.map(([name]) => `--${name}`).join(', ')}.`);
    if (options.context !== undefined) {
      if (options.install !== undefined || options['npm-cache'] !== undefined) throw new Error('Install options require verify --request with enabled execution.');
      if (options.request !== undefined) throw new Error('Give verify --request or --context, not both.');
      process.stdout.write(JSON.stringify(runContext(repository, options), null, options.compact ? 0 : 2) + '\n');
      return;
    }
    // With a split index, each Git read sets the time of the shared index file in .git, so the run reads an unsplit copy.
    const { results, paths, exitCode } = await withUnsplitIndex(repository, () => runVerify(repository, config, options));
    process.stdout.write(JSON.stringify(verifySummary(results, paths), null, options.compact ? 0 : 2) + '\n');
    process.exitCode = exitCode;
  } catch (error) { process.stderr.write(`code-map: ${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 4; }
}
/**
 * A report from the store holds the same facts as the store, so its file and a new folder are private to the user, as in
 * the store. It goes through a new temporary file and a rename, so a symlink at the --out path is replaced, not written through.
 */
function emit(report, stored = false) {
  const json = JSON.stringify(report, null, options.compact ? 0 : 2) + '\n';
  if (!options.out) { process.stdout.write(json); return; }
  const out = resolve(repository ?? process.cwd(), options.out);
  if (stored) writePrivateFile(out, json); else writePage(out, json);
}
function descriptionsWork() {
  const facts = collect(repository, config, options);
  if (options.todo) { process.stdout.write(todoReport(facts.descriptions, facts.files, relative(repository, facts.descriptionsPath)) + '\n'); return; }
  const count = stampDescriptions(facts.descriptionsPath, facts.descriptions, facts.files, options['stamp-all']);
  process.stdout.write(`Stamped ${count} descriptions with their files' current exports.\n`);
}
/** The optional model pass: a work list of test cases to label, or a stamp that records the labelled test files. */
function labelsWork(step) {
  const facts = collect(repository, config, options);
  const shown = relative(repository, facts.labelsPath);
  if (step === undefined) { process.stdout.write(labelsTodo(facts.labels, facts.testFacts, facts.texts, shown, options.file ?? []) + '\n'); return; }
  if (step !== 'stamp' && step !== 'stamp-all') { process.stderr.write(`Unknown command: labels ${step}\n\n${help}`); process.exitCode = 1; return; }
  const count = stampTestLabels(facts.labelsPath, facts.testFacts, facts.texts, step === 'stamp-all', options.file ?? []);
  process.stdout.write(`Stamped the labels of ${count} test files in ${shown}.\n`);
}
/** The page is rebuilt whenever the mapped commit changes, so reloading the browser shows new code. */
async function serve() {
  let cache = { key: null, data: null };
  let place = { directory: repository, note: '' };
  const page = ({ token }) => {
    const key = git(repository, ['rev-parse', 'HEAD']).trim() + git(repository, ['for-each-ref', '--format=%(objectname)', 'refs/heads']);
    if (cache.key !== key || options.worktree) {
      const facts = collect(repository, config, options);
      cache = { key, data: mapData(repository, config, facts, Number(options.history ?? config.history), options.worktree) };
      place = chatWorkspace(repository, facts.reader.sha, cache.data.ref, options.worktree);
      writePage(resolve(repository, options.out ?? config.out), renderPage(cache.data, null));
    }
    return renderPage(cache.data, { token });
  };
  page({ token: '' });
  const port = Number(options.port);
  const started = await startServer({ workspace: () => place, port, page });
  const note = started.port === port ? '' : `  (port ${port} was busy, probably an older code-map; stop it with: lsof -ti tcp:${port} | xargs kill)`;
  process.stdout.write(`Code map of ${cache.data.project}: http://127.0.0.1:${started.port}  (Ctrl+C to stop)${note}\n`);
}
/** The run manifest of one test, compiler, coverage or discovery report, on stdout or in the --out file. The words after "--" are the recorded command. */
function manifestWork(words) {
  try {
    const manifest = buildManifest(repository, config, { artifact: options.artifact, kind: options.kind, exitStatus: options['exit-status'], command: words,
      discovery: options.discovery, filters: options.filter ?? [], workingDirectory: relative(repository, process.cwd()) || '.' });
    const json = JSON.stringify(manifest, null, options.compact ? 0 : 2) + '\n';
    if (options.out) writePrivateFile(resolve(repository, options.out), json); else process.stdout.write(json);
  } catch (error) { process.stderr.write(`code-map: ${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 1; }
}
/** Writes one triage entry. The command line reads the clock, and the triage functions get the date. */
function triageWork(words) {
  try { process.stdout.write(JSON.stringify(triageFinding(repository, config, options, { words, today: calendarDate(new Date()) }), null, options.compact ? 0 : 2) + '\n'); }
  catch (error) { process.stderr.write(`code-map: ${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 1; }
}
/** authorize and run print a JSON summary. A refused or failed command prints only the reason, on stderr, and exits with 1. */
async function workerWork(work) {
  try { const summary = await work(); process.stdout.write(JSON.stringify(summary, null, options.compact ? 0 : 2) + '\n'); }
  catch (error) { process.stderr.write(`code-map: ${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 1; }
}
function init() {
  const configPath = join(repository, '.code-map.json');
  if (!existsSync(configPath)) {
    writeFileSync(configPath, JSON.stringify({ descriptions: defaults.descriptions, out: defaults.out }, null, 2) + '\n');
    process.stdout.write('Created .code-map.json\n');
  }
  const packagePath = join(repository, 'package.json');
  if (!existsSync(packagePath)) { process.stdout.write('No package.json: run `code-map` directly.\n'); return; }
  const text = readFileSync(packagePath, 'utf8');
  const parsed = JSON.parse(text);
  if (parsed.scripts?.map) { process.stdout.write(`package.json already has "map": "${parsed.scripts.map}"\n`); return; }
  // Insert the line in place so the file keeps its own formatting; fall back to rewriting it.
  const scripts = /("scripts"\s*:\s*\{)(\s*)/.exec(text);
  const hasScripts = parsed.scripts && Object.keys(parsed.scripts).length > 0;
  const updated = scripts && hasScripts && scripts[2].includes('\n')
    ? text.replace(scripts[0], `${scripts[1]}${scripts[2]}"map": "code-map",${scripts[2]}`)
    : JSON.stringify({ ...parsed, scripts: { ...parsed.scripts, map: 'code-map' } }, null, 2) + '\n';
  writeFileSync(packagePath, updated);
  process.stdout.write('Added "map": "code-map" to package.json. Run: npm run map\n');
}
