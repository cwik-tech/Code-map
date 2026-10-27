// The fixtures of the package tests: a temporary Git repository with package.json files, code files and an optional
// node_modules folder that Git ignores. This file has no tests, and `npm test` does not run it.
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { collect, mapData } from '../lib/build.mjs';
import { deriveFindings } from '../lib/findings.mjs';
import { loadConfig } from '../lib/project.mjs';

const cli = fileURLToPath(new URL('../bin/code-map.mjs', import.meta.url));

/** The text of a package.json. */
export const manifest = (value) => `${JSON.stringify(value, null, 2)}\n`;

/**
 * A committed project of `files` in a new temporary repository, with a temporary store. `modules` maps the folder of an
 * installed package (for example "node_modules/@scope/pkg") to its package.json. Git ignores node_modules.
 */
export function repository(t, files, modules = {}) {
  const root = mkdtempSync(join(tmpdir(), 'code-map-packages-')), store = mkdtempSync(join(tmpdir(), 'code-map-packages-store-'));
  t.after(() => { rmSync(root, { recursive: true, force: true }); rmSync(store, { recursive: true, force: true }); });
  const put = (path, text) => { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), text); };
  const git = (...args) => execFileSync('git', ['-C', root, '-c', 'user.name=test', '-c', 'user.email=test@example.com', ...args], { encoding: 'utf8' }).trim();
  put('.gitignore', 'node_modules/\n');
  for (const [path, text] of Object.entries(files)) put(path, text);
  for (const [folder, value] of Object.entries(modules)) put(`${folder}/package.json`, manifest(value));
  git('init', '-q', '-b', 'main'); git('add', '.'); git('commit', '-qm', 'fixture');
  const run = (args) => spawnSync(process.execPath, [cli, ...args], { cwd: root, encoding: 'utf8', timeout: 60000 });
  /** The JSON output of a command that must succeed. */
  const json = (args) => {
    const output = run(args);
    if (output.status !== 0) throw new Error(`code-map ${args.join(' ')} failed: ${output.stderr}`);
    return JSON.parse(output.stdout);
  };
  return { root, store, put, git, run, json };
}

/** The analysis of the committed project, its package report and its findings, through the same collector as `inspect`. */
export function analyzed(root, ref = 'HEAD') {
  const config = loadConfig(root), data = mapData(root, config, collect(root, config, { ref }), 2, false);
  return { analysis: data.analysis, packages: data.analysis.packages, findings: deriveFindings(data.analysis) };
}

/** [path, specifier or package] for each finding of one rule, sorted. */
export const leadsOf = (findings, ruleId) => findings.filter((item) => item.ruleId === ruleId)
  .map((item) => [item.location.path, item.facts.specifier ?? item.facts.package ?? null]).sort((a, b) => `${a}`.localeCompare(`${b}`));
