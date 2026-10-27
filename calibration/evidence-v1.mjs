// Proposal-derived defect and clean cases. Each case selects the evidence-v1 rule set explicitly.
import { behavioralCases } from './evidence-v1-behavior.mjs';
const ignored = 'reports/\n.code-map/oracles.json\n';
const base = { '.gitignore': ignored, 'src/a.ts': 'export const value = 1;\n' };
const expected = (id, result, other = {}) => ({ readiness: 'INSUFFICIENT_EVIDENCE', checks: { [id]: result, ...other } });
const make = (id, defect, fields) => ({ id: `v1-${id}`, name: id.replaceAll('-', ' '), profileId: 'evidence-v1', defect,
  base, head: { 'src/a.ts': 'export const value = 2;\n' }, ...fields });
const publicBase = { ...base, 'package.json': '{"main":"src/a.ts"}', 'src/a.ts': 'export function value(a: number): number { return a; }\n',
  'src/b.ts': "import { value } from './a';\nexport const answer = value(1);\n" };
const compiler = (content) => [{ side: 'head', name: 'compiler', kind: 'tsc', content, exitStatus: content ? 2 : 0 }];
const publicHead = { 'src/a.ts': 'export function value(a: number, b: number): number { return a + b; }\n', 'README.md': 'The function adds two arguments.\n' };
const schema = (extra) => `model Item {\n  id Int @id\n${extra}}\n`;
const schemaBase = { ...base, 'prisma/schema.prisma': schema('') };
const lock = (packages) => JSON.stringify({ name: 'fixture', lockfileVersion: 3, packages: { '': { name: 'fixture', version: '1.0.0' }, ...packages } });
const supplyBase = { ...base, '.code-map.json': JSON.stringify({ supplyChain: { deniedLicenses: ['GPL-3.0'], forbidInstallScripts: true } }), 'package-lock.json': lock({}) };
const dependency = (license) => lock({ 'node_modules/pkg': { version: '1.0.0', license, resolved: 'https://registry.npmjs.org/pkg/-/pkg-1.0.0.tgz', integrity: 'sha512-Zm9v' } });
const harness = (failed) => JSON.stringify({ reportType: 'code-map-harness', harnessVersion: 1, mode: 'property', seed: 42, finite: true,
  executed: 1, calls: [{ side: 'head', result: { status: 'returned', output: 1, durationMs: 1 } }], failures: failed ? [{ kind: 'property' }] : [] });
export const cases = [
  make('public-defect', true, { base: publicBase, head: publicHead, evidenceReports: compiler('src/b.ts(2,23): error TS2554: Expected 2 arguments, but got 1.\n'),
    request: { allowedPaths: ['**'] }, expected: expected('structure.public-interface', 'FAIL', { 'structure.types-compatible': 'FAIL' }) }),
  make('public-clean', false, { base: publicBase, head: { ...publicHead, 'src/b.ts': "import { value } from './a';\nexport const answer = value(1, 2);\n" }, evidenceReports: compiler(''),
    request: { allowedPaths: ['**'] }, expected: expected('structure.public-interface', 'PASS') }),
  make('migration-defect', true, { base: schemaBase, head: { 'prisma/schema.prisma': schema('  label String\n') }, request: { allowedPaths: ['**'] },
    expected: expected('completeness.migrations-docs', 'FAIL') }),
  make('migration-clean', false, { base: schemaBase, head: { 'prisma/schema.prisma': schema('  label String\n'), 'prisma/migrations/001/migration.sql': 'ALTER TABLE Item ADD label TEXT;\n' },
    request: { allowedPaths: ['**'] }, expected: expected('completeness.migrations-docs', 'PASS') }),
  make('stale-defect', true, { base: { ...base, 'src/old.mjs': 'export const legacy = 1;\n', 'settings.json': '{"source":"src/old.mjs"}' },
    head: { 'src/old.mjs': null }, expected: expected('completeness.no-stale-references', 'FAIL') }),
  make('stale-clean', false, { base: { ...base, 'src/old.mjs': 'export const legacy = 1;\n', 'settings.json': '{"source":"src/old.mjs"}' },
    head: { 'src/old.mjs': null, 'settings.json': '{}' }, request: { allowedPaths: ['**'] }, expected: expected('completeness.no-stale-references', 'PASS') }),
  make('dependency-defect', true, { base: supplyBase, head: { 'package-lock.json': dependency('GPL-3.0') }, request: { allowedPaths: ['**'] },
    expected: expected('completeness.dependency-policy', 'FAIL') }),
  make('dependency-clean', false, { base: supplyBase, head: { 'package-lock.json': dependency('MIT') }, request: { allowedPaths: ['**'] },
    expected: expected('completeness.dependency-policy', 'PASS') }),
  make('harness-defect', true, { evidenceReports: [{ side: 'head', name: 'harness', kind: 'harness', content: harness(true), exitStatus: 1 }],
    expected: expected('behavior.harness-holds', 'FAIL') }),
  make('harness-clean', false, { evidenceReports: [{ side: 'head', name: 'harness', kind: 'harness', content: harness(false), exitStatus: 0 }],
    expected: expected('behavior.harness-holds', 'PASS') }),
  ...behavioralCases,
];
