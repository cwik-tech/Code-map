import assert from 'node:assert/strict';
import { collectPython } from '../lib/python/collect.mjs';
import { apiSurface } from '../lib/api-surface.mjs';
import { compareApi } from '../lib/api-compare.mjs';
import { fixture, pythonTest } from './python-fixtures.mjs';

function snapshot(t, entries) {
  const root = fixture(t, entries), texts = new Map(Object.entries(entries));
  const facts = collectPython([...texts.keys()], texts, {}, (paths) => new Map(paths.map((p) => [p, texts.get(p)])), root);
  return { data: { analysis: { files: facts.files.map((f) => ({ path: f.path, imports: f.edges })), api: apiSurface(facts.files, []) } } };
}
const compare = (a, b) => compareApi(a, b, { state: 'COMPARABLE' });

pythonTest('Python variadic parameter renames and optional keyword additions are compatible', (t) => {
  const a = snapshot(t, { 'orchard.py': 'def pick(x, *values, **options): pass\nclass Tree:\n def __init__(self, x, **settings): pass\n' });
  const b = snapshot(t, { 'orchard.py': 'def pick(x, *rest, extra=1, **keywords): pass\nclass Tree:\n def __init__(self, x, *, extra=1, **kwargs): pass\n' });
  assert.deepEqual(compare(a, b).items, []);
});

pythonTest('Python keyword-only parameters can become positional or keyword without a break', (t) => {
  const a = snapshot(t, { 'orchard.py': 'def pick(*, value): pass\nclass Tree:\n def grow(self, *, value): pass\n' });
  const b = snapshot(t, { 'orchard.py': 'def pick(value): pass\nclass Tree:\n def grow(self, value): pass\n' });
  assert.deepEqual(compare(a, b).items, []);
});

pythonTest('Python variadic constructor annotations remain part of the class signature', (t) => {
  const a = snapshot(t, { 'orchard.py': 'class Tree:\n def __init__(*values: int): pass\n' });
  const b = snapshot(t, { 'orchard.py': 'class Tree:\n def __init__(*values: str): pass\n' });
  assert.equal(compare(a, b).items[0]?.status, 'CHANGED');
});

pythonTest('Python namespace reexports retain computed public-name uncertainty', (t) => {
  const a = snapshot(t, { 'orchard.py': 'def pick(): pass\n', 'grove/__init__.py': 'import orchard as orchard\n' });
  const b = snapshot(t, { 'orchard.py': '__all__ = discover()\ndef pick(): pass\n', 'grove/__init__.py': 'import orchard as orchard\n' });
  assert.equal(compare(a, b).items.find((i) => i.group === 'public' && i.name === 'orchard')?.status, 'UNKNOWN');
});
