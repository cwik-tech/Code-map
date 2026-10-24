import assert from 'node:assert/strict';
import { test } from 'node:test';
import { project } from './triage-fixtures.mjs';

test('a real architecture finding retains its fingerprint after line moves across commits', (t) => {
  const f = project(t);
  const before = f.summary().findings.items.find((item) => item.ruleId === 'ARCH-RULE');
  assert.match(before.fingerprint, /^[a-f0-9]{16}$/);
  f.put('src/core/engine.ts', "// unrelated line move\n\nimport { view } from '../ui/view';\nexport function engine() { return view(); }\n");
  f.git('add', '.'); f.git('commit', '-qm', 'move import down');
  const after = f.summary().findings.items.find((item) => item.ruleId === 'ARCH-RULE');
  assert.notEqual(after.location.line, before.location.line);
  assert.deepEqual([after.fingerprint, after.id, after.key], [before.fingerprint, before.id, before.key]);
});
