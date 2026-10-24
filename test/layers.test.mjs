// Layer rules (C06, C31): an ordered list of layers in .code-map.json. A file in a lower layer must not import a file in a
// higher layer. The breaks are ARCH-RULE findings, so the existing checks read them. Unit tests on small analyses.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { analyzeFile, createResolver } from '../lib/analyze.mjs';
import { analyzeProject, createReport } from '../lib/analysis.mjs';
import { compareFindings } from '../lib/compare.mjs';
import { deriveFindings } from '../lib/findings.mjs';
import { layerViolations } from '../lib/layers.mjs';
import { loadConfig, settingsProblems } from '../lib/project.mjs';

const layers = [{ name: 'ui', paths: ['src/ui/**'] }, { name: 'domain', paths: ['src/domain/**'] }, { name: 'data', paths: ['src/data/**', 'src/db.ts'] }];
const sources = {
  'src/ui/view.ts': "import { order } from '../domain/order';\nexport const view = () => order();\n",
  'src/domain/order.ts': "import { rows } from '../data/rows';\nimport { view } from '../ui/view';\nexport const order = () => rows() + String(view);\n",
  'src/data/rows.ts': "import { order } from '../domain/order';\nimport { db } from '../db';\nexport const rows = () => db + String(order);\n",
  'src/db.ts': 'export const db = 1;\n',
  'src/util/text.ts': "import { view } from '../ui/view';\nexport const text = String(view);\n",
};

function data(files, settings = {}) {
  const resolve = createResolver(new Set(Object.keys(files)), { aliases: [], baseUrl: null });
  const d = { project: 'fixture', ref: 'working tree', sha: 'fixture', coverageSnapshot: 'working-tree', rules: [], coChanges: { changes: {} }, changes: { uncommitted: [] },
    files: Object.entries(files).map(([path, source]) => analyzeFile(path, source, resolve)), testFiles: [], ...settings };
  d.analysis = analyzeProject(d);
  return d;
}
const archFindings = (d) => deriveFindings(d.analysis).filter((item) => item.ruleId === 'ARCH-RULE');

test('an import from a lower layer to a higher layer is an ARCH-RULE finding with the rule name layer:<lower> -> <higher>', () => {
  const d = data(sources, { layers });
  const { rules } = d.analysis;
  assert.deepEqual(rules.declared, ['layer:domain -> ui', 'layer:data -> ui', 'layer:data -> domain'], 'each forbidden pair of layers is a declared rule');
  assert.deepEqual(rules.violations, [
    { rule: 'layer:domain -> ui', from: 'src/domain/order.ts', to: 'src/ui/view.ts', lines: [2], layers: { from: 'domain', to: 'ui' } },
    { rule: 'layer:data -> domain', from: 'src/data/rows.ts', to: 'src/domain/order.ts', lines: [1], layers: { from: 'data', to: 'domain' } },
  ], 'an import to a lower layer or inside one layer is allowed');
  const first = archFindings(d).find((item) => item.facts.from === 'src/domain/order.ts');
  assert.equal(first.text, 'src/domain/order.ts in the layer "domain" imports src/ui/view.ts in the higher layer "ui". The rule "layer:domain -> ui" forbids it.');
  assert.deepEqual(first.facts, { rule: 'layer:domain -> ui', from: 'src/domain/order.ts', to: 'src/ui/view.ts', layers: { from: 'domain', to: 'ui' } });
  assert.deepEqual(first.key, ['layer:domain -> ui', 'src/domain/order.ts', 'src/ui/view.ts']);
  assert.equal(createReport(d).summary.ruleViolations, 2, 'the report counts the layer breaks with the other rule breaks');
});

test('an exception allows one pair of layers, and the pair is then not a declared rule', () => {
  const d = data(sources, { layers, layerExceptions: [{ from: 'data', to: 'domain' }] });
  assert.deepEqual(d.analysis.rules.declared, ['layer:domain -> ui', 'layer:data -> ui']);
  assert.deepEqual(d.analysis.rules.violations.map((item) => item.rule), ['layer:domain -> ui']);
  assert.deepEqual(d.analysis.rules.layers.exceptions, [{ from: 'data', to: 'domain' }]);
});

test('a file in no layer is outside the model: the model counts it, and no layer rule checks its imports', () => {
  const { layers: model } = data(sources, { layers }).analysis.rules;
  assert.deepEqual(model.layers, [{ name: 'ui', files: 1 }, { name: 'domain', files: 1 }, { name: 'data', files: 2 }]);
  assert.deepEqual(model.outside, { count: 1, paths: ['src/util/text.ts'] });
  assert.equal(data(sources).analysis.rules.layers, null, 'without layers, the model is null');
  assert.equal(layerViolations([], []), null);
});

test('a file that matches the paths of two layers is refused, and so is one glob in two layers', () => {
  const overlap = [{ name: 'ui', paths: ['src/**/*.ts'] }, { name: 'data', paths: ['src/data/**'] }];
  assert.throws(() => data(sources, { layers: overlap }), /The layers "ui" and "data" in \.code-map\.json both match src\/data\/rows\.ts\. Each file must match the paths of one layer at most\./);
  assert.deepEqual(settingsProblems({ layers: [{ name: 'a', paths: ['src/**'] }, { name: 'b', paths: ['src/**'] }] }),
    ['layers[1].paths[0]: The glob "src/**" is also in the layer "a". Each file must match the paths of one layer at most.']);
});

test('the identity key and the text of an existing ARCH-RULE finding do not change, also when layers are declared', () => {
  const files = { 'src/core/engine.ts': "import { view } from '../ui/view';\nexport const engine = () => view();\n", 'src/ui/view.ts': "export const view = () => 'v';\n" };
  // The ID, text and facts that the baseline (before layers) gives for this fixture.
  const expected = { id: 'ARCH-RULE-a9163b3c77', fingerprint: 'a9163b3c77c67507', key: ['core -> ui', 'src/core/engine.ts', 'src/ui/view.ts'],
    text: 'src/core/engine.ts imports src/ui/view.ts, which the rule "core -> ui" forbids.', facts: { rule: 'core -> ui', from: 'src/core/engine.ts', to: 'src/ui/view.ts' } };
  const view = ({ id, fingerprint, key, text, facts }) => ({ id, fingerprint, key, text, facts });
  assert.deepEqual(archFindings(data(files, { rules: ['core -> ui'] })).map(view), [expected]);
  const both = archFindings(data(files, { rules: ['core -> ui'], layers: [{ name: 'core', paths: ['src/core/**'] }, { name: 'ui', paths: ['src/ui/**'] }] }));
  assert.deepEqual(both.map(view), [expected], 'core is the higher layer here, so the import is allowed by the layers and the text rule keeps its finding');
});

test('a new module base makes a text-rule finding UNKNOWN, but not a layer finding, because globs do not use the base', () => {
  const finding = (key, facts) => ({ id: `ARCH-RULE-${key[0].length}`, ruleId: 'ARCH-RULE', fingerprint: key.join('|'), key, paths: key.slice(1), facts, source: 'graph', severity: 'high', location: { path: key[1] } });
  const text = finding(['core -> ui', 'src/core/a.ts', 'src/ui/b.ts'], { rule: 'core -> ui' });
  const layer = finding(['layer:core -> ui', 'src/core/a.ts', 'src/ui/b.ts'], { rule: 'layer:core -> ui', layers: { from: 'core', to: 'ui' } });
  const side = (base, findings) => ({ id: 'A-0', inputs: {}, findings, data: { analysis: { files: [{ path: 'src/core/a.ts' }, { path: 'src/ui/b.ts' }], rules: { base }, tests: { testFiles: [], unreadable: [] } } } });
  // Each head finding has another fingerprint than its base finding, so only the reason decides between UNKNOWN and NEW.
  const head = [{ ...text, id: 'T', fingerprint: 'x' }, { ...layer, id: 'L', fingerprint: 'y' }];
  const result = compareFindings(side('src', [text, layer]), side('src/app', head), { comparability: { state: 'COMPARABLE', reasons: [] } });
  assert.deepEqual([result.statuses.T, result.statuses.L].map((status) => [status.baseline, status.matchedBy]), [['UNKNOWN', 'rule-base-changed'], ['NEW', null]]);
});

test('the layer settings are checked when .code-map.json is read, with a clear error for each problem', (t) => {
  const problems = (settings) => settingsProblems(settings);
  assert.deepEqual(problems({ layers }), []);
  assert.deepEqual(problems({ layers: [], layerExceptions: [] }), [], 'an empty list declares no layer');
  assert.deepEqual(problems({ layers: { ui: ['src/ui/**'] } }), ['layers: Must be a list of { "name", "paths" } objects, from the top layer to the bottom layer.']);
  assert.deepEqual(problems({ layers: [{ name: 'ui', path: ['src/ui/**'] }] }), ['layers[0]: Unknown field "path". A layer has only "name" and "paths".', 'layers[0].paths: Must be a nonempty list of globs.']);
  assert.deepEqual(problems({ layers: [{ name: 'my ui', paths: ['src/ui/**'] }, { name: 'ui', paths: ['/src/x/**', 'src/../y', 'src\\z', ''] }, { name: 'ui', paths: ['src/w/**'] }] }), [
    'layers[0].name: Must be 1 to 64 letters, digits, ".", "_" or "-", and start with a letter or a digit.',
    'layers[1].paths[0]: Must be relative to the repository root.', 'layers[1].paths[1]: Must not contain a ".." segment.',
    'layers[1].paths[2]: Must use "/" separators, not backslashes.', 'layers[1].paths[3]: Must be a nonempty string of at most 1024 characters.',
    'layers[2].name: The name "ui" is also the name of layers[1].']);
  assert.deepEqual(problems({ layerExceptions: [{ from: 'data', to: 'ui' }] }), ['layerExceptions: Needs "layers".']);
  const many = (count) => Array.from({ length: count }, (_, index) => ({ name: `l${index}`, paths: [`src/l${index}/**`] }));
  assert.deepEqual([problems({ layers: many(50) }), problems({ layers: many(51) })], [[], ['layers: Must have at most 50 layers. It has 51.']],
    'each pair of layers is a rule, so the limit keeps the rules few');
  assert.deepEqual(problems({ layers, layerExceptions: [{ from: 'ui', to: 'data' }, { from: 'data', to: 'web' }, { from: 'data' }, 'data -> ui'] }), [
    'layerExceptions[0]: "ui" is above "data", and a higher layer can always import a lower layer. "from" must name the lower layer.',
    'layerExceptions[1].to: "web" is not the name of a layer.', 'layerExceptions[2].to: Must be the name of a layer.',
    'layerExceptions[3]: Must be an object { "from", "to" } with two layer names.']);
  const root = mkdtempSync(join(tmpdir(), 'code-map-layers-config-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(join(root, '.code-map.json'), JSON.stringify({ layers: [{ name: 'ui' }] }));
  assert.throws(() => loadConfig(root), { message: 'layers[0].paths: Must be a nonempty list of globs.' });
});
