import assert from 'node:assert/strict';
import { test } from 'node:test';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { analyzeFile, createResolver } from '../lib/analyze.mjs';
import { renderPage } from '../lib/build.mjs';
import { readCoverage } from '../lib/coverage.mjs';

const resolveImport = createResolver(new Set(['src/a.ts', 'src/b.ts', 'src/c.ts']), { aliases: [], baseUrl: null });
const fact = (path, source) => ({ ...analyzeFile(path, source, resolveImport), tests: [], source, status: 'missing', summary: '' });

function fixture() {
  return { project: 'regression', ref: 'working tree', sha: 'fixture', roots: ['src'], modules: {}, folders: {}, budgets: {}, tour: [],
    files: [fact('src/a.ts', 'export function run(x: string): string;\nexport function run(x: string) { return x; }\nexport declare function pending(): void;'),
      fact('src/b.ts', "import {run, pending} from './a'; export const b = () => run('x');"),
      fact('src/c.ts', "import type {pending} from './a'; export const c = 1;")],
    tests: 1, testFiles: [{ ...fact('test/a.test.ts', "import {run} from '../src/a';"), imports: ['src/a.ts'] }],
    history: { files: ['src/a.ts'], snapshots: [{ sha: 'fixture', date: '2026-10-16', subject: 'fixture', sizes: [[0, 4]] }] },
    changes: { commits: [{ sha: 'fixture', date: '2026-10-16', subject: 'change', files: ['src/a.ts', 'src/c.ts'] }], base: null, uncommitted: null },
    coChanges: { changes: { 'src/a.ts': 3 }, partners: { 'src/a.ts': [['src/c.ts', 3]] } },
    rules: [], coverage: null, coverageSnapshot: 'working-tree' };
}

const chrome = process.env.CODE_MAP_CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
function browser(data, probe) {
  const folder = mkdtempSync(join(tmpdir(), 'code-map-repair-'));
  try {
    const path = join(folder, 'map.html');
    const script = `<script>try { const result = (() => { ${probe} })(); const out = document.createElement('pre'); out.id = 'repair-result'; out.textContent = JSON.stringify(result); document.body.append(out); } catch (e) { const out = document.createElement('pre'); out.id = 'repair-result'; out.textContent = JSON.stringify({error:String(e)}); document.body.append(out); }</script>`;
    writeFileSync(path, renderPage(data, null).replace('</body>', script + '</body>'));
    const p = spawnSync(chrome, ['--headless', '--disable-gpu', '--disable-background-networking', '--no-first-run', '--no-default-browser-check', '--user-data-dir=' + join(folder, 'profile'), '--dump-dom', pathToFileURL(path).href], {encoding:'utf8', timeout:25000, maxBuffer:30*1024*1024});
    assert.ifError(p.error);
    assert.equal(p.status, 0, p.stderr);
    const match = /<pre id="repair-result">([\s\S]*?)<\/pre>/.exec(p.stdout);
    assert.ok(match, 'real viewer must finish initialization and emit probe result');
    const result = JSON.parse(match[1].replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&amp;', '&'));
    assert.equal(result.error, undefined, result.error);
    return result;
  } finally { rmSync(folder, {recursive:true, force:true}); }
}
const browserOptions = {skip: existsSync(chrome) ? false : 'Set CODE_MAP_CHROME to an installed Chrome executable', timeout:30000};

test('implemented overload signatures are not marked declaration-only', () => {
  const f = fact('src/a.ts', 'export function parse(x: string): string;\nexport function parse(x: number): number;\nexport function parse(x: string | number) { return x; }\nexport declare function pending(): void;');
  assert.deepEqual(f.declarations.filter(d => d.planned).map(d => d.name), ['pending']);
});

test('explicit type-only names remain navigable but are excluded from value-capable imports', () => {
  const f = fact('src/b.ts', "import type {A} from './a'; import {type B, run as go} from './a'; export type {C} from './a';");
  assert.deepEqual(f.imports, ['src/a.ts']);
  assert.deepEqual(f.uses['src/a.ts'], ['A', 'B', 'run', 'C']);
  assert.deepEqual(f.valueUses['src/a.ts'], ['run']);
});

test('LCOV keeps missing, malformed and incomplete counts unknown while retaining measured zero', () => {
  const folder = mkdtempSync(join(tmpdir(), 'code-map-lcov-'));
  try {
    writeFileSync(join(folder, 'lcov.info'), 'SF:src/zero.ts\nLF:10\nLH:0\nend_of_record\nSF:src/good.ts\nLF:10\nLH:4\nend_of_record\nSF:src/missing.ts\nLF:10\nend_of_record\nSF:src/bad.ts\nLF:wat\nLH:0\nend_of_record\nSF:src/excess.ts\nLF:2\nLH:3\nend_of_record\nSF:src/negative.ts\nLF:-2\nLH:0\nend_of_record\nSF:src/fraction.ts\nLF:1.5\nLH:0\nend_of_record\nSF:src/empty.ts\nLF:\nLH:0\nend_of_record\n');
    const cov = readCoverage(folder, {coverage:'lcov.info'});
    assert.deepEqual(cov.files, {'src/zero.ts':[10,0], 'src/good.ts':[10,4]});
    assert.equal(cov.revision, null);
    assert.equal(cov.command, null);
  } finally { rmSync(folder, {recursive:true, force:true}); }
});

test('selected affected file and multi-file change render blast radius and retain co-change navigation', browserOptions, () => {
  const result = browser(fixture(), `state.selected = nodes.get('src/a.ts'); state.tab = 'blast'; renderPanel(); const selected = panel.innerHTML; panel.querySelector('[data-bm="change"]').click(); const pick=panel.querySelector('.brpick'); pick.value='c1'; pick.dispatchEvent(new Event('change',{bubbles:true})); return {selected, change:panel.innerHTML, promises:promisesOf(byPath.get('src/a.ts')).map(p => ({name:p.d.name,waiting:p.waiting}))};`);
  assert.match(result.selected, /files affected/);
  assert.match(result.selected, /changes together \(Git\)/);
  assert.match(result.change, /Changed files · 2/);
  assert.deepEqual(result.promises, [{name:'pending', waiting:['src/b.ts']}]);
});

test('partial coverage remains unknown across cards, tiles, checks, gaps and priority', browserOptions, () => {
  const data = fixture();
  data.coverage = {file:'partial.lcov.info', date:'2026-10-16', revision:null, command:null, files:{'src/a.ts':[10,5], 'src/b.ts':[5,0]}};
  const result = browser(data, `return {missing:coverageOf('src/c.ts'), valid:coverageOf('src/a.ts'), zero:coverageOf('src/b.ts'), tile:tileCoverage(nodes.get('src/c.ts')), group:tileCoverage(root), checks:checksList(), priority:testPriorityChart(), gap:isGap('src/a.ts'), details:filePanel(nodes.get('src/c.ts'))};`);
  assert.equal(result.missing, null);
  assert.equal(result.tile, null);
  assert.equal(result.group, null, 'a partial group cannot claim complete coverage');
  assert.equal(result.valid.pct, 50);
  assert.equal(result.zero.pct, 0);
  assert.equal(result.gap, false);
  assert.match(result.details, /[Cc]overage unknown/);
  assert.match(result.checks, /[Cc]overage unknown · 1/);
  assert.match(result.checks, /[Zz]ero recorded hits · 1/);
  assert.match(result.priority, /[Cc]overage unknown · 1/);
  assert.doesNotMatch(result.priority, /data-go="src\/c.ts"[^>]*data-tip2=/);
  assert.match(result.checks, /no revision or test-command binding/);
});

test('working-folder LCOV cannot measure a mapped commit or a historical slider snapshot', browserOptions, () => {
  const data = fixture(); data.coverageSnapshot = 'unbound-revision';
  data.coverage = {file:'lcov.info', date:'2026-10-16', files:{'src/a.ts':[10,10]}};
  const result = browser(data, `const commit = coverageOf('src/a.ts'); DATA.coverageSnapshot = 'working-tree'; state.snap = 0; return {commit, historical:coverageOf('src/a.ts'), checks:checksList()};`);
  assert.equal(result.commit, null);
  assert.equal(result.historical, null);
  assert.match(result.checks, /no revision or test-command binding/);
});

test('cycles, namespace imports and co-change show static limits without claiming runtime defects', browserOptions, () => {
  const data = fixture(); data.files[0].imports = ['src/b.ts'];
  data.files[1] = fact('src/b.ts', "import * as all from './a'; export const b = 1;");
  const result = browser(data, `return {checks:checksList(), health:fileHealth(byPath.get('src/a.ts')), users:usersOfName('src/a.ts','run')};`);
  assert.match(result.checks, /includes type-only/);
  assert.match(result.health.callouts, /does not establish a runtime/);
  assert.match(result.health.accordions, /correlation/);
  assert.doesNotMatch(result.health.callouts, /cannot be understood/);
  assert.ok(result.users.includes('src/b.ts'));
});

test('zero-hit gaps use measured evidence and historical navigation clears their cached status', browserOptions, () => {
  const data = fixture();
  data.testFiles[0].imports = ['src/a.ts','src/b.ts','src/c.ts'];
  data.coverage = {file:'partial.lcov.info', date:'2026-10-16', files:{'src/a.ts':[10,5], 'src/b.ts':[5,0]}};
  data.history.snapshots.push({...data.history.snapshots[0], sha:'next'});
  const result = browser(data, `state.selected=nodes.get('src/a.ts'); state.tab='blast'; renderPanel(); const current=panel.innerHTML; const gaps=blastNow().gaps.map(x=>x.path); const unknownGap=isGap('src/c.ts'); blastSize('src/a.ts'); setSnap(0); return {current,gaps,unknownGap,historicalGaps:blastNow().gaps.map(x=>x.path),cachedGaps:blastSize('src/a.ts').gaps};`);
  assert.deepEqual(result.gaps, ['src/b.ts']);
  assert.equal(result.unknownGap, false);
  assert.match(result.current, /no recorded hits/);
  assert.match(result.current, /class="sq gap"[^>]*data-go="src\/b.ts"/);
  assert.deepEqual(result.historicalGaps, []);
  assert.equal(result.cachedGaps, 0);
});

test('reexports are not local missing bodies and explicit type namespaces never imply value imports', () => {
  const f = fact('src/b.ts', "export {run as wrapped} from './a'; import type * as types from './a'; import type Default from './c'; export {type pending} from './a';");
  assert.deepEqual(f.declarations, []);
  assert.deepEqual(f.exports, ['pending','wrapped']);
  assert.deepEqual(f.valueUses['src/a.ts'], ['run']);
  assert.deepEqual(f.valueUses['src/c.ts'], []);
});

test('invalid and zero-instrumented viewer counts stay unknown without NaN colours or priorities', browserOptions, () => {
  const data = fixture();
  data.coverage = {file:'invalid.lcov.info',date:'2026-10-16',files:{'src/a.ts':[0,0],'src/b.ts':[10,-1],'src/c.ts':[10,'0']}};
  const result = browser(data, `state.colour='coverage'; renderLegend(); return {counts:DATA.files.map(f=>coverageOf(f.path)),tiles:DATA.files.map(f=>tileCoverage(nodes.get(f.path))),checks:checksList(),priority:testPriorityChart(),legend:document.getElementById('legend').textContent};`);
  assert.deepEqual(result.counts, [null,null,null]);
  assert.deepEqual(result.tiles, [null,null,null]);
  assert.match(result.checks, /Coverage unknown · 3/);
  assert.match(result.priority, /Coverage unknown · 3/);
  assert.doesNotMatch(result.priority, /NaN|undefined/);
  assert.match(result.legend, /unknown/);
});

test('class overload signatures share only implementations in the same static or instance scope', () => {
  const f = fact('src/a.ts', `export class Box {
    constructor(value: string);
    constructor(value: number);
    constructor(value: string | number) {}
    parse(value: string): string;
    parse(value: string) { return value; }
    static parse(value: number): number;
    static parse(value: number) { return value; }
  }
  export abstract class Half {
    abstract parse(value: string): string;
    static parse(value: string) { return value; }
  }
  export declare class Ambient { constructor(value: string); parse(value: string): string; }`);
  assert.deepEqual(f.declarations[0].children.map(d=>d.planned), [false,false,false,false,false,false,false]);
  assert.deepEqual(f.declarations[1].children.map(d=>d.planned), [true,false]);
  assert.deepEqual(f.declarations[2].children.map(d=>d.planned), [true,true]);
});

test('class declaration rows and progress do not mark implemented overloads as missing', browserOptions, () => {
  const data = fixture();
  data.files[0] = fact('src/a.ts', `export abstract class Box {
    constructor(value: string);
    constructor(value: string) {}
    parse(value: string): string;
    parse(value: string) { return value; }
    abstract pending(): void;
  }`);
  const result = browser(data, `const file=nodes.get('src/a.ts'); return {progress:progressOf(file),constructor:declPanel(file.children[0].children[0]),pending:declPanel(file.children[0].children[4])};`);
  assert.equal(result.progress.planned, 1);
  assert.doesNotMatch(result.constructor, /declaration only; provider unverified/);
  assert.match(result.pending, /declaration only; provider unverified/);
});
