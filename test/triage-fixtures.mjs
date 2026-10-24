// Fixtures for the triage tests through the CLI: a committed project with findings, a temporary store, and helpers that run
// code-map and follow its printed commands. This file has no tests, and `npm test` does not run it.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const cli = fileURLToPath(new URL('../bin/code-map.mjs', import.meta.url));
export const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
/** The calendar date (UTC) `days` after today, in the form that the CLI uses. */
export const day = (days = 0) => new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

/** Splits a printed command the way a POSIX shell does for plain words and single-quoted words. */
export function words(command) {
  const out = [];
  for (const match of command.matchAll(/'((?:[^']|'\\'')*)'|(\S+)/g)) out.push(match[1] !== undefined ? match[1].replaceAll("'\\''", "'") : match[2]);
  return out;
}

/**
 * A committed project with ten exported names in src/lib/spares.ts that no importer uses. Without `clean`, the engine also
 * imports the view, which breaks the rule "core -> ui".
 */
export function project(t, { clean = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'code-map-triage-')), work = mkdtempSync(join(tmpdir(), 'code-map-triage-work-')), store = join(work, 'store');
  t.after(() => { rmSync(root, { recursive: true, force: true }); rmSync(work, { recursive: true, force: true }); });
  const put = (path, text) => { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), text); };
  const git = (...args) => execFileSync('git', ['-C', root, '-c', 'user.name=test', '-c', 'user.email=test@example.com', ...args], { encoding: 'utf8' });
  put('.code-map.json', JSON.stringify({ rules: ['core -> ui'] }));
  put('src/core/engine.ts', clean ? 'export function engine() { return 1; }\n' : "import { view } from '../ui/view';\nexport function engine() { return view(); }\n");
  put('src/ui/view.ts', "import { spare0 } from '../lib/spares';\nexport function view() { return 'v' + spare0; }\n");
  put('src/lib/spares.ts', Array.from({ length: 11 }, (_, i) => `export const spare${i} = ${i};`).join('\n') + '\n');
  put('test/engine.test.ts', "import { test, expect } from 'vitest';\nimport { engine } from '../src/core/engine';\ntest('engine works', () => { expect(engine()).toBeTruthy(); });\n");
  git('init', '-q', '-b', 'main'); git('add', '.'); git('commit', '-qm', 'fixture');
  const run = (args) => spawnSync(process.execPath, [cli, ...args], { cwd: root, encoding: 'utf8', timeout: 60000 });
  const json = (args) => { const output = run(args); assert.equal(output.status, 0, output.stderr); return JSON.parse(output.stdout); };
  /** Runs a command exactly as a report printed it, with more arguments at the end. */
  const follow = (command, more = []) => { const [program, ...args] = words(command); assert.equal(program, 'code-map'); return json([...args, ...more]); };
  const fails = (args, pattern) => {
    const output = run(args);
    assert.notEqual(output.status, 0, `${args.join(' ')} must fail`);
    assert.equal(output.stdout, '');
    assert.match(output.stderr, pattern);
  };
  return { root, work, store, put, git, run, json, follow, fails,
    summary: (...args) => json(['inspect', '--summary', '--ref', 'HEAD', '--store', store, ...args]),
    triage: (...args) => json(['triage', '--store', store, ...args]),
    /** A triage file with these entries, written by hand. */
    write: (entries) => put('.code-map-triage.json', JSON.stringify({ triageVersion: 1, entries }, null, 2) + '\n') };
}

/** The EXPORT-UNREFERENCED findings of src/lib/spares.ts in a list of report items. */
export const spares = (items) => items.filter((item) => item.ruleId === 'EXPORT-UNREFERENCED' && item.location.path === 'src/lib/spares.ts');
/** A hand-written entry for a report item. */
export const entryFor = (item, fields = {}) => ({ fingerprint: item.fingerprint, ruleId: item.ruleId, state: 'dismissed', reason: 'Kept for a plugin.', owner: 'ana', date: day(), ...fields });
