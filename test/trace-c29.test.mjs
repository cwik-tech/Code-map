import assert from 'node:assert/strict';
import { test } from 'node:test';
import { typedFacts } from '../lib/types/collect.mjs';
import { findReferences, referenceTerms } from '../lib/impact/references.mjs';
import { repository } from './packages-fixture.mjs';

test('a source diff extracts removed function and deprecated interface names without configured migration patterns', (t) => {
  const f = repository(t, {
    'package.json': '{"name":"pkg","main":"src/api.ts"}',
    'src/api.ts': 'export function legacyCall() { return 1; }\n/** @deprecated Use CurrentShape. */\nexport interface LegacyShape { value: number }\n',
    'docs/guide.md': 'Use legacyCall and LegacyShape.\n',
  });
  f.put('src/api.ts', 'export const currentValue = 2;\n');
  f.git('add', '.'); f.git('commit', '-qm', 'remove legacy API');
  const summary = f.json(['inspect', '--summary', '--ref', 'HEAD', '--base', 'HEAD~1', '--store', f.store]);
  const page = f.json(['inspect', '--analysis', summary.analysis.id, '--base-analysis', summary.comparison.base.id,
    '--impact', 'references', '--store', f.store]);
  assert.deepEqual(page.page.items.map((hit) => [hit.path, hit.term.name]), [['docs/guide.md', 'legacyCall'], ['docs/guide.md', 'LegacyShape']]);
});

test('stale named imports are searched alongside config docs and generated consumers', () => {
  const terms = referenceTerms([{ status: 'REMOVED', path: 'src/api.ts', name: 'legacyValue' }], [], []);
  const result = findReferences(new Map([
    ['src/use.ts', 'import { legacyValue } from "./api";'],
    ['tool.config.ts', 'export const plugin = "legacyValue";'],
    ['docs/guide.md', 'Use legacyValue.'],
    ['dist/use.js', 'import { legacyValue } from "../src/api";'],
  ]), terms, []);
  assert.deepEqual(result.hits.map((hit) => [hit.path, hit.place, hit.term.name]), [
    ['dist/use.js', 'generated', 'legacyValue'], ['docs/guide.md', 'markdown', 'legacyValue'],
    ['src/use.ts', 'code', 'legacyValue'], ['tool.config.ts', 'config', 'legacyValue'],
  ]);
});

test('language-service references bind named and default import uses while excluding shadowed names', () => {
  const result = typedFacts(new Map([
    ['tsconfig.json', '{"compilerOptions":{"strict":true},"include":["src"]}'],
    ['src/api.ts', 'export const namedValue = 1; export default function value() { return 2; }'],
    ['src/use.ts', 'import localDefault, { namedValue as localNamed } from "./api";\nlocalDefault();\nlocalNamed;\nfunction shadow(localNamed: number) { return localNamed; }'],
  ]));
  assert.equal(result.state, 'COMPLETE');
  assert.deepEqual(result.references.filter((ref) => ref.path === 'src/use.ts' && ref.line > 1).map(({ line, name, target, evidence }) =>
    ({ line, name, target, evidence })), [
    { line: 2, name: 'default', target: 'src/api.ts', evidence: 'language-service' },
    { line: 3, name: 'namedValue', target: 'src/api.ts', evidence: 'language-service' },
  ]);
});
