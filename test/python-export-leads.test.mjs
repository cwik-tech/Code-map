import assert from 'node:assert/strict';
import { collectPython } from '../lib/python/collect.mjs';
import { analyzeFile, createResolver } from '../lib/analyze.mjs';
import { analyzeProject } from '../lib/analysis.mjs';
import { deriveFindings } from '../lib/findings.mjs';
import { apiSurface } from '../lib/api-surface.mjs';
import { compareApi } from '../lib/api-compare.mjs';
import { fixture, pythonTest } from './python-fixtures.mjs';

function scan(t, entries) {
  const root = fixture(t, entries), texts = new Map(Object.entries(entries));
  const facts = collectPython([...texts.keys()], texts, {}, () => texts, root);
  const analysis = analyzeProject({ files: facts.files, testFiles: facts.testFacts });
  return { facts, analysis, findings: deriveFindings(analysis),
    data: { analysis: { files: facts.files, api: apiSurface(facts.files, facts.testFacts) } } };
}
const definitions = 'def gather(): pass\nclass Sprout: pass\nlantern = 1\n_anchor = 0\n';
const entries = (prefix = '') => ({ 'meadow.py': prefix + definitions,
  'visitor.py': 'from meadow import _anchor\n',
  'tests/test_meadow.py': 'from meadow import Sprout\ndef test_sprout():\n assert Sprout() is not None\n' });
const exportLeads = (result) => result.findings.filter((f) => ['EXPORT-UNREFERENCED', 'EXPORT-TEST-ONLY'].includes(f.ruleId));

pythonTest('Python implicit public names give no export leads but retain API and test candidates', (t) => {
  const result = scan(t, entries());
  assert.deepEqual(exportLeads(result), []);
  assert.deepEqual(result.facts.files.find((f) => f.path === 'meadow.py').exports, ['Sprout', 'gather', 'lantern']);
  assert.ok(result.findings.some((f) => f.ruleId === 'TEST-EXPORT-CANDIDATE' && f.location.symbol === 'gather'));
  const removed = scan(t, { ...entries(), 'meadow.py': '' });
  const comparison = compareApi(result, removed, { state: 'COMPARABLE' });
  assert.deepEqual(comparison.items.map((i) => [i.name, i.status]), [['Sprout', 'REMOVED'], ['gather', 'REMOVED'], ['lantern', 'REMOVED']]);
});

pythonTest('Python literal public lists retain unused and test-only export leads', (t) => {
  const result = scan(t, entries('__all__ = ["gather", "Sprout", "lantern"]\n'));
  assert.deepEqual(exportLeads(result).map((f) => [f.ruleId, f.location.symbol]).sort(), [
    ['EXPORT-TEST-ONLY', 'Sprout'], ['EXPORT-UNREFERENCED', 'gather'], ['EXPORT-UNREFERENCED', 'lantern'],
  ]);
});

pythonTest('Python explicit reexports retain export leads without a public list', (t) => {
  const result = scan(t, { 'seeds.py': definitions,
    'meadow.py': 'from seeds import gather as gather\nimport seeds as seeds\n_anchor = 0\n',
    'visitor.py': 'from meadow import _anchor\n',
    'tests/test_meadow.py': 'from meadow import seeds\ndef test_seeds():\n assert seeds.lantern == 1\n' });
  assert.deepEqual(exportLeads(result).map((f) => [f.location.path, f.ruleId, f.location.symbol]).sort(), [
    ['meadow.py', 'EXPORT-TEST-ONLY', 'seeds'], ['meadow.py', 'EXPORT-UNREFERENCED', 'gather'],
  ]);
});

pythonTest('Python computed public lists give no export leads even for explicit reexports', (t) => {
  const result = scan(t, { ...entries('__all__ = discover()\nfrom seeds import gather as gather\n'), 'seeds.py': definitions });
  assert.deepEqual(exportLeads(result).filter((f) => f.location.path === 'meadow.py'), []);
  assert.equal(result.facts.files.find((f) => f.path === 'meadow.py').python.publicApi.state, 'UNKNOWN');
});

pythonTest('TypeScript and JavaScript export findings remain byte identical beside Python modules', (t) => {
  const result = scan(t, entries());
  const sources = { 'beacon.ts': 'export const unusedBeacon = 1;\n', 'signal.js': 'export const unusedSignal = 1;\n',
    'visitor.ts': "import './beacon';\nimport './signal';\n" };
  const resolve = createResolver(new Set(Object.keys(sources)), { aliases: [], baseUrl: null });
  const files = Object.entries(sources).map(([path, text]) => analyzeFile(path, text, resolve));
  const standalone = deriveFindings(analyzeProject({ files, testFiles: [] })).filter((f) => f.ruleId.startsWith('EXPORT-'));
  const mixed = deriveFindings(analyzeProject({ files: [...files, ...result.facts.files], testFiles: result.facts.testFacts }))
    .filter((f) => f.ruleId.startsWith('EXPORT-') && /\.[jt]s$/.test(f.location.path));
  assert.deepEqual(standalone.map((f) => [f.ruleId, f.location.symbol]).sort(), [
    ['EXPORT-UNREFERENCED', 'unusedBeacon'], ['EXPORT-UNREFERENCED', 'unusedSignal'],
  ]);
  assert.equal(JSON.stringify(mixed), JSON.stringify(standalone));
});
