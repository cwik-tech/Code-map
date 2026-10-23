#!/usr/bin/env node
// code-map: a zoomable map of a codebase. Run it inside any Git repository.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { collect, mapData, renderPage, writePage } from '../lib/build.mjs';
import { createReport } from '../lib/analysis.mjs';
import { isRetrieval, retrieve } from '../lib/inspect.mjs';
import { stampDescriptions, todoReport } from '../lib/descriptions.mjs';
import { labelsTodo, stampTestLabels } from '../lib/test-labels.mjs';
import { summarizeTests } from '../lib/test-summary.mjs';
import { runVerify, verifySummary } from '../lib/verify.mjs';
import { withUnsplitIndex } from '../lib/verify-change.mjs';
import { writePrivateFile } from '../lib/store.mjs';
import { buildManifest } from '../lib/manifest.mjs';
import { git, repositoryRoot } from '../lib/git.mjs';
import { defaults, loadConfig } from '../lib/project.mjs';
import { startServer } from '../lib/server.mjs';
import { chatWorkspace } from '../lib/snapshot.mjs';

const help = `code-map: a zoomable map of a codebase

Usage (inside a Git repository; with npm: npm run map, npm run map serve, …):
  code-map                 build the map page (see "out" below)
  code-map serve           build it and open it with a chat about the code at http://127.0.0.1:4477
  code-map inspect         emit structural analysis as JSON (no HTML or model calls)
  code-map inspect --summary   analyze once, store the analysis, print a small overview with follow-up commands
  code-map verify --request <file.json>   check one change from a base commit to a head under a rule set: four ratings and a readiness state
  code-map manifest --artifact <report> --kind <kind> --exit-status <n> -- <test command>
                           write the run manifest of a test report that your own test run wrote (runs nothing)
  code-map init            add "npm run map" and a .code-map.json to this project
  code-map todo            list files whose description is missing or stale
  code-map stamp           record the current exports of newly described files (stamp-all: all of them)
  code-map labels          list test cases whose intent labels are missing or stale (optional model pass)
  code-map labels stamp    record the test version that new labels describe (--file <test>: refresh that file; stamp-all: all)

Options:
  --ref <branch>           map this branch or commit (default: the branch whose source changed most recently)
  --worktree               map the working tree, including uncommitted changes
  --out <file>             where to write the page (default: ${defaults.out})
  --descriptions <file>    descriptions file (default: ${defaults.descriptions})
  --labels <file>          test intent labels file (default: ${defaults.testLabels})
  --json                   emit JSON instead of HTML (also the default for inspect)
  --file <path>            inspect a mapped source file; repeat to select several (labels: a test file)
  --change <selection>     inspect latest, branch, or uncommitted changes
  --exclude-vendors        omit primitive/vendor paths from report file details
  --summary                with inspect: print the overview of the stored analysis (created or reused)
  --analysis <id>          with inspect: read this stored analysis instead of the code (no new collection)
  --finding <id>           with --analysis: one finding and its evidence
  --findings               with --analysis: a page of findings (--rule <rule id> to filter)
  --part <name>            with --finding or one --file: one complete evidence list, a page at a time
  --offset <n>, --limit <n>  page position and size for --part and --findings (default 0 and 20, at most 500)
  --full                   with --analysis: the whole-project report (large; write it with --out)
  --base <ref>             with --summary: also analyze this base commit and label findings new, existing or resolved
  --base-analysis <id>     with --analysis and --findings or --summary: compare with this stored base analysis
  --baseline <label>       with --base-analysis --findings: only new, existing, resolved or unknown findings
  --store <folder>         analysis store (default: CODE_MAP_STORE, XDG_CACHE_HOME/code-map or ~/.cache/code-map)
  --request <file>         with verify: the verification request (JSON)
  --out-dir <folder>       with verify: where the run folders and latest.json go, outside the repository (default: a folder for this repository in the store's verifications folder)
  --compact                write JSON without indentation
  --port <number>          port for serve (default: 4477)
`;

const spec = {
  ref: { type: 'string' }, worktree: { type: 'boolean', default: false }, out: { type: 'string' },
  json: { type: 'boolean', default: false }, file: { type: 'string', multiple: true }, change: { type: 'string' },
  'exclude-vendors': { type: 'boolean', default: false },
  descriptions: { type: 'string' }, labels: { type: 'string' }, history: { type: 'string' }, todo: { type: 'boolean', default: false },
  stamp: { type: 'boolean', default: false }, 'stamp-all': { type: 'boolean', default: false },
  serve: { type: 'boolean', default: false }, port: { type: 'string', default: '4477' }, help: { type: 'boolean', short: 'h', default: false },
  summary: { type: 'boolean', default: false }, analysis: { type: 'string' }, finding: { type: 'string' }, findings: { type: 'boolean', default: false },
  rule: { type: 'string' }, part: { type: 'string' }, offset: { type: 'string' }, limit: { type: 'string' }, full: { type: 'boolean', default: false },
  store: { type: 'string' }, compact: { type: 'boolean', default: false }, request: { type: 'string' }, 'out-dir': { type: 'string' },
  base: { type: 'string' }, 'base-analysis': { type: 'string' }, baseline: { type: 'string' },
  artifact: { type: 'string' }, kind: { type: 'string' }, 'exit-status': { type: 'string' }, discovery: { type: 'string' }, filter: { type: 'string', multiple: true },
};
let parsed;
try { parsed = parseArgs({ allowPositionals: true, options: spec }); } catch (error) {
  // verify exits with 4 for an invalid request, because 1 means REVIEW there. The command is the first word that is not an
  // option or an option value, so the other commands keep exit 1 when a file or a ref has the name "verify".
  const first = parseArgs({ allowPositionals: true, strict: false, options: spec }).positionals[0];
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
  if (!storedOnly) { process.stderr.write('code-map needs to run inside a Git repository.\n'); process.exit(failure); }
}
let config = null;
if (repository !== null && !storedOnly) {
  try { config = loadConfig(repository); } catch (error) {
    process.stderr.write(`code-map: Cannot use ${join(repository, '.code-map.json')}: ${error instanceof Error ? error.message : String(error)}\n`); process.exit(failure);
  }
}

// Plain-word commands (`code-map serve`) work through `npm run map serve`, which needs no `--` divider.
const command = positionals[0];
if (command === 'serve') options.serve = true;
else if (command === 'todo') options.todo = true;
else if (command === 'stamp') options.stamp = true;
else if (command === 'stamp-all') options['stamp-all'] = true;
else if (command === 'help') { process.stdout.write(help); process.exit(0); }

if (command === 'init') init();
else if (command === 'verify') verify();
else if (command === 'manifest') manifestWork(positionals.slice(1));
else if (command === 'labels' && positionals.length <= 2) labelsWork(positionals[1]);
else if (positionals.length > 1 || (command && !['serve', 'todo', 'stamp', 'stamp-all', 'inspect'].includes(command))) {
  process.stderr.write(`Unknown command: ${positionals.join(' ')}\n\n${help}`); process.exit(1);
}
else if (command === 'inspect' || options.json) {
  try { if (isRetrieval(options)) emit(retrieve(repository, config, options), true); else inspect(); }
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

/** Exits with the code of the readiness state: 0 READY, 1 REVIEW, 2 BLOCKED, 3 INSUFFICIENT_EVIDENCE, and 4 for an invalid request or a failure. */
function verify() {
  const allowed = new Set(['request', 'store', 'out-dir', 'compact']);
  const extra = Object.entries(options).filter(([name, value]) => !allowed.has(name) && value !== undefined && value !== false && !(name === 'port' && value === '4477'));
  try {
    if (positionals.length > 1) throw new Error(`verify takes no other words: ${positionals.slice(1).join(' ')}.`);
    if (extra.length) throw new Error(`verify takes only --request, --store, --out-dir and --compact, not ${extra.map(([name]) => `--${name}`).join(', ')}.`);
    // With a split index, each Git read sets the time of the shared index file in .git, so the run reads an unsplit copy.
    const { results, paths, exitCode } = withUnsplitIndex(repository, () => runVerify(repository, config, options));
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

/** The run manifest of one test report, on stdout or in the --out file. The words after "--" are the recorded command. */
function manifestWork(words) {
  try {
    const manifest = buildManifest(repository, config, { artifact: options.artifact, kind: options.kind, exitStatus: options['exit-status'], command: words,
      discovery: options.discovery, filters: options.filter ?? [] });
    const json = JSON.stringify(manifest, null, options.compact ? 0 : 2) + '\n';
    if (options.out) writePrivateFile(resolve(repository, options.out), json); else process.stdout.write(json);
  } catch (error) { process.stderr.write(`code-map: ${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 1; }
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
