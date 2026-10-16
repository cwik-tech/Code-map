#!/usr/bin/env node
// code-map: a zoomable map of a codebase. Run it inside any Git repository.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { collect, mapData, renderPage, writePage } from '../lib/build.mjs';
import { stampDescriptions, todoReport } from '../lib/descriptions.mjs';
import { git, repositoryRoot } from '../lib/git.mjs';
import { defaults, loadConfig } from '../lib/project.mjs';
import { startServer } from '../lib/server.mjs';
import { chatWorkspace } from '../lib/snapshot.mjs';

const help = `code-map: a zoomable map of a codebase

Usage (inside a Git repository; with npm: npm run map, npm run map serve, …):
  code-map                 build the map page (see "out" below)
  code-map serve           build it and open it with a chat about the code at http://127.0.0.1:4477
  code-map init            add "npm run map" and a .code-map.json to this project
  code-map todo            list files whose description is missing or stale
  code-map stamp           record the current exports of newly described files (stamp-all: all of them)

Options:
  --ref <branch>           map this branch or commit (default: the branch whose source changed most recently)
  --worktree               map the working tree, including uncommitted changes
  --out <file>             where to write the page (default: ${defaults.out})
  --descriptions <file>    descriptions file (default: ${defaults.descriptions})
  --port <number>          port for serve (default: 4477)
`;

const { values: options, positionals } = parseArgs({ allowPositionals: true, options: {
  ref: { type: 'string' }, worktree: { type: 'boolean', default: false }, out: { type: 'string' },
  descriptions: { type: 'string' }, history: { type: 'string' }, todo: { type: 'boolean', default: false },
  stamp: { type: 'boolean', default: false }, 'stamp-all': { type: 'boolean', default: false },
  serve: { type: 'boolean', default: false }, port: { type: 'string', default: '4477' }, help: { type: 'boolean', short: 'h', default: false },
} });

if (options.help) { process.stdout.write(help); process.exit(0); }

let repository;
try { repository = repositoryRoot(process.cwd()); } catch {
  process.stderr.write('code-map needs to run inside a Git repository.\n'); process.exit(1);
}
const config = loadConfig(repository);

// Plain-word commands (`code-map serve`) work through `npm run map serve`, which needs no `--` divider.
const command = positionals[0];
if (command === 'serve') options.serve = true;
else if (command === 'todo') options.todo = true;
else if (command === 'stamp') options.stamp = true;
else if (command === 'stamp-all') options['stamp-all'] = true;
else if (command === 'help') { process.stdout.write(help); process.exit(0); }

if (command === 'init') init();
else if (positionals.length > 1 || (command && !['serve', 'todo', 'stamp', 'stamp-all'].includes(command))) {
  process.stderr.write(`Unknown command: ${positionals.join(' ')}\n\n${help}`); process.exit(1);
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

function descriptionsWork() {
  const facts = collect(repository, config, options);
  if (options.todo) { process.stdout.write(todoReport(facts.descriptions, facts.files, relative(repository, facts.descriptionsPath)) + '\n'); return; }
  const count = stampDescriptions(facts.descriptionsPath, facts.descriptions, facts.files, options['stamp-all']);
  process.stdout.write(`Stamped ${count} descriptions with their files' current exports.\n`);
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
