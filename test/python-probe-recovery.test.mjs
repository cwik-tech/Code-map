import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { findInterpreter } from '../lib/python/interpreter.mjs';
import { fixture, pythonTest } from './python-fixtures.mjs';

const quote = (value) => `'${value.replaceAll("'", "'\\''")}'`;

function recoveringInterpreter(t) {
  const interpreter = findInterpreter().interpreter;
  const repository = fixture(t, { 'app.py': 'pass' });
  const outside = mkdtempSync(join(tmpdir(), 'code-map-recovering-python-'));
  const wrapper = join(outside, 'python3'), marker = join(outside, 'attempted');
  // A real executable fails once, then delegates to the installed Python. No internal module is replaced.
  writeFileSync(wrapper, `#!/bin/sh\nif [ ! -f ${quote(marker)} ]; then\n  : > ${quote(marker)}\n  exit 75\nfi\nexec ${quote(interpreter.path)} "$@"\n`);
  chmodSync(wrapper, 0o755);
  const previous = process.env.CODE_MAP_PYTHON;
  process.env.CODE_MAP_PYTHON = wrapper;
  t.after(() => {
    if (previous === undefined) delete process.env.CODE_MAP_PYTHON; else process.env.CODE_MAP_PYTHON = previous;
    rmSync(outside, { recursive: true, force: true });
  });
  return { repository, version: interpreter.version };
}

pythonTest('an unsuccessful Python probe retains its exit status in the UNKNOWN reason', (t) => {
  const f = recoveringInterpreter(t);
  const result = findInterpreter(undefined, f.repository);
  assert.equal(result.state, 'UNKNOWN');
  assert.match(result.reason, /exited with (?:code|status) 75/);
});

pythonTest('a later interpreter lookup can recover after a transient probe failure without executable changes', (t) => {
  const f = recoveringInterpreter(t);
  assert.equal(findInterpreter(undefined, f.repository).state, 'UNKNOWN');
  const recovered = findInterpreter(undefined, f.repository);
  assert.equal(recovered.state, 'KNOWN', recovered.reason);
  assert.equal(recovered.interpreter.version, f.version);
});
