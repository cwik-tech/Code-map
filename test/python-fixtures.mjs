import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { findInterpreter } from '../lib/python/interpreter.mjs';

const available = findInterpreter().state === 'KNOWN';
export function fixture(t, entries) {
  const root = mkdtempSync(join(tmpdir(), 'python-code-map-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const [path, text] of Object.entries(entries)) {
    mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), text);
  }
  execFileSync('git', ['init', '-q', '-b', 'main', root]);
  execFileSync('git', ['-C', root, 'add', '.']);
  execFileSync('git', ['-C', root, '-c', 'user.name=test', '-c', 'user.email=test@local', 'commit', '-qm', 'fixture']);
  return root;
}
export const pythonTest = (name, fn) => test(name, { skip: available ? false : 'No Python 3 interpreter is available' }, fn);

