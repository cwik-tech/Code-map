// Ownership (C31): CODEOWNERS with the GitHub rules (the last matching pattern wins), the owners of each source file,
// and the optional cross-owner import rule of .code-map.json. Unit tests on small analyses.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { analyzeFile, createResolver } from '../lib/analyze.mjs';
import { analyzeProject } from '../lib/analysis.mjs';
import { findCodeowners, isOwner, ownerMatcher, parseCodeowners } from '../lib/codeowners.mjs';
import { remapKey } from '../lib/compare.mjs';
import { deriveFindings, findingRules } from '../lib/findings.mjs';
import { settingsProblems } from '../lib/project.mjs';

const text = [
  '# Owners of the fixture.',
  '*                     @org/platform',
  '*.md                  docs@example.com',
  'apps/                 @org/apps         # any apps folder',
  '/docs/                @org/docs',
  'docs/*                @org/flat',
  '**/logs               @org/logs',
  '/src/core/            @org/core @org/platform',
  '/src/core/legacy.ts',
  '!src/core/skip.ts     @org/none',
  'src/[ab]/x.ts         @org/range',
  'src/bad.ts            not-an-owner',
  '\\#notes               @org/hash',
  '',
].join('\n');

test('CODEOWNERS: the last matching pattern wins, with directory, anchored and floating patterns as on GitHub', () => {
  const parsed = parseCodeowners(text), owners = ownerMatcher(parsed.rules);
  assert.deepEqual(parsed.rules.map((rule) => [rule.line, rule.pattern, rule.owners.length]), [[2, '*', 1], [3, '*.md', 1], [4, 'apps/', 1], [5, '/docs/', 1], [6, 'docs/*', 1],
    [7, '**/logs', 1], [8, '/src/core/', 2], [9, '/src/core/legacy.ts', 0], [13, '#notes', 1]]);
  const table = [
    ['src/index.ts', ['@org/platform'], 2],
    ['README.md', ['docs@example.com'], 3],
    ['web/apps/main.ts', ['@org/apps'], 4],
    ['apps', ['@org/platform'], 2], // "apps/" matches only a folder
    ['docs/guide/intro.md', ['@org/flat'], 6], // a matching directory also owns its descendants
    ['docs/a.md', ['@org/flat'], 6],
    ['build/logs/x.log', ['@org/logs'], 7],
    ['src/core/engine.ts', ['@org/core', '@org/platform'], 8],
    ['src/core/legacy.ts', [], 9], // a pattern without owners leaves the file without an owner
    ['src/core/skip.ts', ['@org/core', '@org/platform'], 8], // the negated line is ignored
    ['#notes', ['@org/hash'], 13],
    ['Src/Core/engine.ts', ['@org/platform'], 2], // paths are case-sensitive
  ];
  assert.deepEqual(table.map(([path]) => [path, owners(path).owners, owners(path).line]), table);
  assert.deepEqual(ownerMatcher([])('src/a.ts'), { owners: [], line: null });
});

test('CODEOWNERS: a negation, a character range and an invalid owner are ignored and recorded with the line and the reason', () => {
  assert.deepEqual(parseCodeowners(text).ignored, [
    { line: 10, text: '!src/core/skip.ts     @org/none', reason: 'GitHub does not support a negated pattern ("!").' },
    { line: 11, text: 'src/[ab]/x.ts         @org/range', reason: 'GitHub does not support a character range ("[ ]").' },
    { line: 12, text: 'src/bad.ts            not-an-owner', reason: '"not-an-owner" is not a user (@name), a team (@org/name) or an email address.' },
  ]);
  assert.deepEqual(parseCodeowners('src/a\\*.ts @x\n/ @y\n').ignored.map((item) => [item.line, item.reason]),
    [[1, 'Code-map supports only the escapes "\\#" and "\\ " in a pattern.'], [2, 'The pattern names no path.']]);
  assert.deepEqual(parseCodeowners('src/my\\ file.ts @x\r\n').rules.map((rule) => [rule.pattern, rule.owners]), [['src/my file.ts', ['@x']]], 'an escaped space is part of the pattern');
});

test('GitHub reads the first CODEOWNERS file in .github/, the root and docs/, in that order', () => {
  assert.equal(findCodeowners(['docs/CODEOWNERS', 'CODEOWNERS', 'src/a.ts']), 'CODEOWNERS');
  assert.equal(findCodeowners(['docs/CODEOWNERS', '.github/CODEOWNERS', 'CODEOWNERS']), '.github/CODEOWNERS');
  assert.equal(findCodeowners(['docs/CODEOWNERS']), 'docs/CODEOWNERS');
  assert.equal(findCodeowners(['src/CODEOWNERS', 'codeowners']), null);
});

const owners = '* @org/platform\n/src/web/ @org/web\n/src/core/ @org/core\n/src/shared/ @org/web @org/core\n/src/core/legacy.ts\n';
const sources = {
  'src/web/page.ts': "import { engine } from '../core/engine';\nimport { both } from '../shared/both';\nimport { util } from '../lib/util';\nexport const page = [engine, both, util];\n",
  'src/core/engine.ts': "import { legacy } from './legacy';\nimport { both } from '../shared/both';\nexport const engine = [legacy, both];\n",
  'src/core/legacy.ts': 'export const legacy = 1;\n',
  'src/shared/both.ts': 'export const both = 1;\n',
  'src/lib/util.ts': 'export const util = 1;\n',
};
function analysis(settings) {
  const resolve = createResolver(new Set(Object.keys(sources)), { aliases: [], baseUrl: null });
  const files = Object.entries(sources).map(([path, source]) => analyzeFile(path, source, resolve));
  return analyzeProject({ files, testFiles: [], coChanges: { changes: {} }, rules: [], codeowners: { path: '.github/CODEOWNERS', text: owners }, ...settings });
}

test('the analysis records the owners of each source file and counts the files without an owner; ownership alone is information', () => {
  const { ownership } = analysis({});
  assert.equal(ownership.file, '.github/CODEOWNERS');
  assert.deepEqual(ownership.files['src/core/engine.ts'], { owners: ['@org/core'], line: 3 });
  assert.deepEqual(ownership.files['src/shared/both.ts'], { owners: ['@org/web', '@org/core'], line: 4 });
  assert.deepEqual(ownership.files['src/core/legacy.ts'], { owners: [], line: 5 });
  assert.deepEqual([ownership.unowned, ownership.owners, ownership.policy, ownership.violations], [1, ['@org/core', '@org/platform', '@org/web'], null, []]);
  assert.deepEqual(deriveFindings(analysis({})).filter((item) => item.ruleId === 'OWNER-CROSS-IMPORT'), [], 'without the ownership setting, no import is a finding');
  assert.equal(analyzeProject({ files: [], testFiles: [], coChanges: { changes: {} } }).ownership, null, 'no CODEOWNERS file and no setting: no ownership section');
});

test('with forbidCrossOwnerImports, an import between files without a common owner is an OWNER-CROSS-IMPORT finding, unless an exception allows it', () => {
  const policy = { forbidCrossOwnerImports: true, allowed: [{ from: '@org/web', to: '@org/platform' }] };
  const { ownership } = analysis({ ownershipPolicy: policy });
  assert.deepEqual(ownership.violations, [{ from: 'src/web/page.ts', to: 'src/core/engine.ts', owners: { from: ['@org/web'], to: ['@org/core'] }, lines: [1] }],
    'a common owner (shared/both.ts), an allowed pair (lib/util.ts) and a target without an owner (legacy.ts) are not findings');
  const [finding] = deriveFindings(analysis({ ownershipPolicy: policy })).filter((item) => item.ruleId === 'OWNER-CROSS-IMPORT');
  assert.deepEqual([finding.severity, finding.source, finding.capability, finding.key, finding.location], ['medium', 'graph', 'C31', ['src/web/page.ts', 'src/core/engine.ts'],
    { path: 'src/web/page.ts', line: 1, symbol: null }]);
  assert.equal(finding.text, 'src/web/page.ts (owned by @org/web) imports src/core/engine.ts (owned by @org/core). The ownership setting in .code-map.json forbids an import between files without a common owner.');
  assert.equal(findingRules['OWNER-CROSS-IMPORT'].capability, 'C31');
  const without = analysis({ ownershipPolicy: { forbidCrossOwnerImports: true } }).ownership.violations.map((item) => item.to);
  assert.deepEqual(without, ['src/core/engine.ts', 'src/lib/util.ts'], 'without the exception, the import of lib/util.ts is a finding too');
  assert.deepEqual(analysis({ ownershipPolicy: { forbidCrossOwnerImports: false, allowed: [] } }).ownership.violations, []);
  assert.deepEqual(remapKey('OWNER-CROSS-IMPORT', ['src/a.ts', 'src/b.ts'], (path) => path.replace('src/', 'lib/')), ['lib/a.ts', 'lib/b.ts'], 'a comparison moves both paths through renames');
});

test('the ownership settings are checked when .code-map.json is read', () => {
  assert.deepEqual(settingsProblems({ ownership: { forbidCrossOwnerImports: true, allowed: [{ from: '@org/web', to: 'core@example.com' }] } }), []);
  assert.deepEqual(settingsProblems({ ownership: true }), ['ownership: Must be an object { "forbidCrossOwnerImports", "allowed" }.']);
  assert.deepEqual(settingsProblems({ ownership: { forbidCrossOwnerImport: true, forbidCrossOwnerImports: 'yes', allowed: {} } }), [
    'ownership: Unknown field "forbidCrossOwnerImport". The ownership settings have only "forbidCrossOwnerImports" and "allowed".',
    'ownership.forbidCrossOwnerImports: Must be true or false.', 'ownership.allowed: Must be a list of { "from", "to" } objects.']);
  assert.deepEqual(settingsProblems({ ownership: { allowed: [{ from: 'web', to: '@org/core' }, { from: '@a', to: '@a' }, 'x', { from: '@a', to: '@b', why: 'x' }] } }), [
    'ownership.allowed[0].from: "web" is not a user (@name), a team (@org/name) or an email address.',
    'ownership.allowed[1]: "from" and "to" name the same owner. Files of one owner can always import each other.',
    'ownership.allowed[2]: Must be an object { "from", "to" } with two owners.',
    'ownership.allowed[3]: Unknown field "why". An exception has only "from" and "to".']);
});

test('owners are compared without regard to case, as on GitHub, so one team in two spellings is one owner', () => {
  assert.deepEqual(parseCodeowners('* @Org/Web @org/web Docs@Example.com\n').rules[0].owners, ['@org/web', 'docs@example.com']);
  const mixed = { codeowners: { path: 'CODEOWNERS', text: '* @Org/Platform\n/src/web/ @Org/Web\n/src/core/ @org/web\n/src/shared/ @org/web\n/src/core/legacy.ts\n' } };
  assert.deepEqual(analysis({ ...mixed, ownershipPolicy: { forbidCrossOwnerImports: true } }).ownership.violations.map((item) => item.to), ['src/lib/util.ts'],
    '"@Org/Web" and "@org/web" are one owner, so only the import of lib/util.ts (@org/platform) is a finding');
  const allowed = analysis({ ...mixed, ownershipPolicy: { forbidCrossOwnerImports: true, allowed: [{ from: '@ORG/WEB', to: '@org/PLATFORM' }] } });
  assert.deepEqual([allowed.ownership.violations, allowed.ownership.owners], [[], ['@org/platform', '@org/web']]);
  assert.deepEqual(settingsProblems({ ownership: { allowed: [{ from: '@Org/Web', to: '@org/web' }] } }),
    ['ownership.allowed[0]: "from" and "to" name the same owner. Files of one owner can always import each other.']);
});

test('CODEOWNERS parses long patterns and bounds ignored lines', () => {
  assert.equal(isOwner(`a@${'.'.repeat(200000)}@`), false, 'the email test is linear');
  assert.deepEqual(ownerMatcher(parseCodeowners(`a${'/'.repeat(200000)}b @x\n`).rules)('a/b').owners, [], 'a long run of "/" in a pattern is linear');
  const [long] = parseCodeowners(`!${'x'.repeat(5000)} @a\n`).ignored;
  assert.equal(long.text, `!${'x'.repeat(199)}…`, 'the analysis keeps at most 200 characters of an ignored line');
  assert.deepEqual(['a@b.co', 'a@b', 'a@.b', 'a@b.', '@org/team', '@a/b/c'].map(isOwner), [true, false, false, false, true, false]);
});


test('a trailing escape is ignored instead of crashing or changing the pattern', () => {
  const parsed = parseCodeowners('\\\nfoo\\\n* @org/base\n');
  assert.deepEqual(parsed.rules, [{ line: 3, pattern: '*', owners: ['@org/base'] }]);
  assert.deepEqual(parsed.ignored.map(({ line, reason }) => ({ line, reason })), [
    { line: 1, reason: 'The line ends with an incomplete escape.' },
    { line: 2, reason: 'The line ends with an incomplete escape.' },
  ]);
});

test('wildcard directory matches include their descendants', () => {
  const match = ownerMatcher(parseCodeowners('* @base\n/docs/* @docs\n/src/*.js @js\n').rules);
  assert.deepEqual(['docs/a.md', 'docs/sub/a.md', 'src/tool.js/nested.ts', 'other/docs/a.md'].map((path) => match(path).owners),
    [['@docs'], ['@docs'], ['@js'], ['@base']]);
});
