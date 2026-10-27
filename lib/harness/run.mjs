// Prepares fixed harness files in the worker workspace. No project code runs on the host.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { git } from '../git.mjs';
import { runCommand } from '../worker/run.mjs';
import { exportCommit } from '../worker/workspace.mjs';
import { migrationMetadata } from './migrate-prepare.mjs';
import { validateSpec } from './spec.mjs';
import { projectLoader } from './loader.mjs';
import { boundaryCases, trustedRows } from './metadata.mjs';
import { regressionFixtures } from './fixtures.mjs';
import { inside, jsonFile } from './files.mjs';

export const harnessCommand = ['node', '.code-map-harness/runtime.mjs'];
const sources = ['runtime.mjs', 'call.mjs', 'generator.mjs', 'normalize.mjs', 'spec.mjs', 'files.mjs', 'loader.mjs', 'route.mjs', 'schema.mjs', 'effects.mjs', 'corpus.mjs', 'coverage.mjs', 'migrate.mjs'];
/** Runs one validated harness through the authorized restricted worker. */
export function runHarness(repository, config, request, context = {}) {
  const spec = validateSpec(request.spec);
  const prepare = (workspace, inputs) => {
    const folder = join(workspace.tree, '.code-map-harness');
    mkdirSync(folder, { mode: 0o700 });
    for (const name of ['models', 'harness', 'adapters']) mkdirSync(join(folder, name), { mode: 0o700 });
    writeFileSync(join(folder, 'runtime.mjs'), "import './harness/runtime.mjs';\n", { flag: 'wx', mode: 0o600 });
    for (const file of sources) writeFileSync(join(folder, 'harness', file), readFileSync(new URL(file, import.meta.url)), { flag: 'wx', mode: 0o600 });
    for (const file of ['validate.mjs', 'state-model.mjs', 'decision-table.mjs']) {
      writeFileSync(join(folder, 'models', file), readFileSync(new URL(`../models/${file}`, import.meta.url)), { flag: 'wx', mode: 0o600 });
    }
    writeFileSync(join(folder, 'adapters', 'run-manifest.mjs'), readFileSync(new URL('../adapters/run-manifest.mjs', import.meta.url)), { flag: 'wx', mode: 0o600 });
    const metadata = {};
    if (spec.mode === 'migrate') metadata.migrations = migrationMetadata(repository, workspace.tree, inputs, spec);
    if (['zod-boundaries', 'json-boundaries', 'range-boundaries'].includes(spec.mode)) metadata.boundaries = boundaryCases(workspace.tree, spec.subject, spec);
    if (spec.mode === 'decision-table') metadata.rows = trustedRows(workspace.tree, spec.table);
    if (spec.mode === 'differential') {
      const base = git(repository, ['rev-parse', '--verify', `${spec.base}^{commit}`]).trim();
      const target = join(folder, 'base'); mkdirSync(target, { mode: 0o700 });
      exportCommit(repository, base, target); metadata.base = { ref: spec.base, sha: base };
    }
    const subjects = [...(spec.subject ? [spec.subject] : []), ...(spec.invariant ? [spec.invariant] : [])];
    for (const tree of [workspace.tree, ...(spec.mode === 'differential' ? [join(folder, 'base')] : [])]) {
      for (const subject of subjects) inside(tree, subject.file);
      projectLoader(tree, subjects);
    }
    writeFileSync(join(folder, 'spec.json'), JSON.stringify(spec), { flag: 'wx', mode: 0o600 });
    writeFileSync(join(folder, 'metadata.json'), JSON.stringify(metadata), { flag: 'wx', mode: 0o600 });
  };
  return runCommand(repository, config, { authorization: request.authorization, head: request.head, worktree: request.worktree,
    store: request.store, budgets: request.budgets, command: harnessCommand, kind: 'harness', artifact: '.code-map-harness/result.json' }, { ...context, prepare }).then(regressionFixtures);
}

/** Checks harness CLI options and reads the strict JSON spec inside the repository. */
export function harnessWork(repository, config, options, positionals) {
  const allowed = ['authorization', 'spec', 'store', 'head', 'worktree', 'compact'];
  const extra = Object.entries(options).filter(([key, value]) => !allowed.includes(key) && value !== undefined && value !== false && !(key === 'port' && value === '4477'));
  if (extra.length || positionals.length !== 1) throw new Error('harness takes only --authorization, --spec, --head or --worktree, --store and --compact');
  if (typeof options.spec !== 'string') throw new Error('harness needs --spec <file>');
  return runHarness(repository, config, { authorization: options.authorization, spec: jsonFile(repository, options.spec), store: options.store, head: options.head, worktree: options.worktree });
}
