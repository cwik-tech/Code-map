import assert from 'node:assert/strict';
import { collectPython } from '../lib/python/collect.mjs';
import { analyzeProject } from '../lib/analysis.mjs';
import { deriveFindings } from '../lib/findings.mjs';
import { fixture, pythonTest } from './python-fixtures.mjs';

pythonTest('Python stubs retain private-import and optional-import rules', (t) => {
  const entries = { 'orchard.pyi': 'def public(): ...\ndef _private(): ...\n',
    'grove.pyi': 'from orchard import _private\ntry:\n from .optional import value\nexcept ImportError:\n pass\n' };
  const root = fixture(t, entries), texts = new Map(Object.entries(entries));
  const facts = collectPython([...texts.keys()], texts, {}, (paths) => new Map(paths.map((p) => [p, texts.get(p)])), root);
  const findings = deriveFindings(analyzeProject({ files: facts.files, testFiles: [] }));
  assert.deepEqual(findings.filter((f) => ['IMPORT-NAME-MISSING', 'IMPORT-UNRESOLVED'].includes(f.ruleId)), []);
});

pythonTest('Python unknown all names do not collide with the star reexport protocol', async (t) => {
  const { apiSurface } = await import('../lib/api-surface.mjs');
  const { compareApi } = await import('../lib/api-compare.mjs');
  const entries = { 'grove/__init__.py': '__all__ = ["*"]\n', 'orchard.py': '__all__ = ["*"]\n' };
  const root = fixture(t, entries), texts = new Map(Object.entries(entries));
  const facts = collectPython([...texts.keys()], texts, {}, (paths) => new Map(paths.map((p) => [p, texts.get(p)])), root);
  const stored = { data: { analysis: { files: facts.files.map((f) => ({ path: f.path, imports: f.edges })), api: apiSurface(facts.files, []) } } };
  assert.deepEqual(compareApi(stored, stored, { state: 'COMPARABLE' }).items.map((i) => i.status), ['UNKNOWN', 'UNKNOWN']);
});
