import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { renderReport, writeRun } from '../lib/verify-report.mjs';
import { comparisonReasons, terms } from '../lib/verify-words.mjs';

const posix = { skip: process.platform === 'win32' && 'needs POSIX modes and symlinks' };
const permissions = { skip: process.platform === 'win32' ? 'needs POSIX modes' : process.getuid?.() === 0 ? 'root ignores folder permissions' : false };

/** An open check. Each test overrides only the fields that it is about. */
const check = (id, fields = {}) => ({ id, category: 'structuralIntegrity', required: true, blocking: false, severity: 'medium', applicability: 'APPLICABLE',
  result: 'UNKNOWN', eligible: false, review: 'none', evidenceIds: [], title: `Check ${id}`, rationale: `The evidence for ${id} is not available.`, nextAction: null, ...fields });
const completeness = (completed, total, optional = [0, 0]) => ({ required: { completed, total }, optional: { completed: optional[0], total: optional[1] }, unknown: total - completed, skipped: 0 });
const rating = (fields = {}) => ({ state: 'UNASSESSED', value: null, label: 'Unassessed', reason: 'The minimum assessment evidence for this category is not available.',
  predicates: { met: [], unmet: [], unknown: [] }, failures: [], missingEvidence: [], minimumEvidenceMet: false, rubricConfigured: true, rejectedDisposition: null,
  evidenceCompleteness: completeness(0, 1), ...fields });
const exitCodes = { READY: 0, REVIEW: 1, BLOCKED: 2, INSUFFICIENT_EVIDENCE: 3 };
const state = (name) => ({ state: name, blocking: name === 'BLOCKED' ? ['si.arch-rule'] : [], insufficient: name === 'INSUFFICIENT_EVIDENCE' ? ['vc.head-run'] : [],
  review: name === 'REVIEW' ? ['cc.settings'] : [], unassessedCategories: [], unsupportedCategories: [], failedCategories: [], reason: 'From the obligations.', exitCode: exitCodes[name] });

/** The results of a typical run of the static rule set: one blocking failure, one other failure, open checks and limits. */
function results(fields = {}) {
  return { reportType: 'code-map-verification', schemaVersion: 1, runId: 'V-0123456789abcdef', createdAt: '2026-10-22T18:00:00.000Z', profileId: 'static-baseline-v0',
    ratingRulesVersion: 'ratings-v0', changeType: 'refactor', intent: 'Move the parser into its own module', request: { digest: 'c'.repeat(64) },
    base: { ref: 'main', sha: 'a'.repeat(40), analysisId: 'A-1111111111111111' },
    head: { ref: 'worktree', sha: 'b'.repeat(40), analysisId: 'A-2222222222222222', worktreeDigest: 'd'.repeat(64) },
    comparison: { state: 'COMPARABLE', reasons: [] },
    readiness: { ...state('BLOCKED'), insufficient: ['vc.head-run'], unassessedCategories: ['verificationCoverage', 'behavioralConfidence'], failedCategories: ['structuralIntegrity'] },
    ratings: {
      structuralIntegrity: rating({ state: 'RATED', value: 1, label: 'Failing', reason: 'A verified fundamental failure under the category rubric: si.new-architecture-break.',
        failures: ['si.new-architecture-break'], evidenceCompleteness: completeness(2, 3) }),
      verificationCoverage: rating({ missingEvidence: ['a bound head test report', 'a bound line-coverage report'] }),
      behavioralConfidence: rating({ evidenceCompleteness: completeness(0, 1, [0, 1]) }),
      changeCompleteness: rating({ state: 'RATED', value: 2, label: 'Weak', reason: 'Material problems or gaps prevent the level-3 conditions.', minimumEvidenceMet: true,
        predicates: { met: [], unmet: ['obligation:cc.settings'], unknown: [] }, evidenceCompleteness: completeness(1, 1) }) },
    obligations: [
      check('cc.settings', { category: 'changeCompleteness', title: 'Code-map settings unchanged', result: 'FAIL', eligible: true, evidenceIds: ['.code-map.json'],
        rationale: 'The change edits .code-map.json.', nextAction: 'Undo the edit of .code-map.json, or ask a person to review it.' }),
      check('si.arch-rule', { title: 'No new architecture-rule break', blocking: true, severity: 'high', result: 'FAIL', eligible: true, evidenceIds: ['ARCH-RULE-0123456789'],
        rationale: 'The head has a NEW ARCH-RULE finding.', nextAction: 'code-map inspect --analysis A-2222222222222222 --base-analysis A-1111111111111111 --findings --baseline new --rule ARCH-RULE' }),
      check('vc.head-run', { category: 'verificationCoverage', title: 'A bound test run of the head exists', rationale: 'There is no bound head report.',
        nextAction: 'Add a JUnit report and its run manifest to reportInputs in the request.' }),
      check('bc.earlier', { category: 'behavioralConfidence', required: false, title: 'Earlier failures', result: 'PASS', eligible: false }),
      check('cc.docs', { category: 'changeCompleteness', required: false, title: 'Migrations and documentation', result: 'SKIPPED' }),
      check('si.imports', { title: 'New imports resolve', result: 'PASS', eligible: true }),
      check('si.types', { title: 'Types are compatible', applicability: 'NOT_APPLICABLE', applicabilityReason: 'The project has no TypeScript sources.', result: 'NOT_APPLICABLE' }),
    ],
    change: { total: 3, paths: ['src/a.ts', 'src/b.ts', 'src/parser/index.ts'] },
    executions: [{ artifact: 'reports/junit.xml', kind: 'junit', side: 'head', binding: 'STALE', eligible: false,
      reasons: [{ key: 'sha', message: 'The report ran on commit 0123456789, but the analysis is of bbbbbbbbbb.' }], cases: 12, failed: 0 }],
    gaps: [{ key: 'execution', source: 'inventory', text: 'Code-map ran no project test or command.' },
      { key: 'dynamicImports', source: 'graph', count: 2, text: 'Dynamic imports with a computed target are not resolved.' }],
    limits: ['Verification Coverage needs a bound line-coverage report, and Code-map cannot import one yet.'],
    llmHypotheses: [], ...fields };
}

/** The lines of one "## " section, without its heading. */
function section(markdown, heading) {
  const lines = markdown.split('\n'), start = lines.indexOf(`## ${heading}`);
  assert.notEqual(start, -1, `the report has the section "${heading}"`);
  const end = lines.findIndex((line, index) => index > start && line.startsWith('## '));
  return lines.slice(start + 1, end === -1 ? undefined : end);
}
const rows = (lines) => lines.filter((line) => line.startsWith('| ') && !line.startsWith('| ---'));
const cells = (row) => row.replace(/\\\|/g, '').split('|').length - 2;
const lead = (fields) => renderReport(results(fields)).split('\n').find((line) => line.startsWith('**'));

test('the report starts with the intent and says what the readiness state means and which exit code it gives', () => {
  const paragraph = lead();
  assert.equal(renderReport(results()).split('\n')[0], '# Verification report: Move the parser into its own module');
  for (const pattern of [/^\*\*The readiness of this change is BLOCKED\.\*\*/, /The change is not ready\. A blocking check stops the change at once/, /1 blocking check failed/, /exits with code 2/]) assert.match(paragraph, pattern);
});

test('each readiness state has its own meaning and its own exit code', () => {
  const paragraphs = Object.entries(exitCodes).map(([name, code]) => {
    const paragraph = lead({ readiness: state(name) });
    assert.match(paragraph, new RegExp(`is ${name}\\.\\*\\*`));
    assert.match(paragraph, new RegExp(`exits with code ${code} `));
    return paragraph.replace(/code \d/, '');
  });
  assert.equal(new Set(paragraphs).size, 4);
  assert.match(paragraphs[3], /Some required evidence is missing, so Code-map cannot decide whether the change is ready\./);
});

test('an INSUFFICIENT_EVIDENCE paragraph says that required evidence is missing and names each required check that failed', () => {
  const obligations = [check('cc.settings', { result: 'FAIL', eligible: true }), check('cc.tests', { result: 'FAIL', eligible: true }), check('vc.head-run'),
    check('bc.earlier', { required: false, result: 'FAIL', eligible: true })];
  const paragraph = lead({ readiness: { ...state('INSUFFICIENT_EVIDENCE'), review: ['cc.settings', 'cc.tests', 'bc.earlier'] }, obligations });
  assert.match(paragraph, /Some required evidence is missing.* 1 required check has no result\. 2 required checks failed: `cc\.settings` and `cc\.tests`\./);
  assert.doesNotMatch(paragraph, /not a failure|bc\.earlier/);
  assert.match(lead({ readiness: state('INSUFFICIENT_EVIDENCE'), obligations: [check('vc.head-run')] }), /1 required check has no result\. No required check failed\./);
});

test('the report names the base, the head, the rule set and the number of changed files', () => {
  const compared = section(renderReport(results()), 'What Code-map compared').join('\n');
  for (const pattern of [/\| Base \| `main` at commit `a{40}`/, /\| Head \| The working tree on commit `b{40}`/, /`d{64}`/, /\| Rule set \| `static-baseline-v0` with the rating rules `ratings-v0` \|/,
    /\| Changed files \| 3 files \|/, /The two analyses are comparable/, /`reports\/junit\.xml`.*\| No \|.*The report ran on commit 0123456789/]) assert.match(compared, pattern);
  const commit = section(renderReport(results({ head: { ref: 'feature', sha: 'e'.repeat(40), analysisId: 'A-3333333333333333', worktreeDigest: null }, change: { total: 1, paths: ['a.ts'] } })), 'What Code-map compared').join('\n');
  for (const pattern of [/\| Head \| `feature` at commit `e{40}`/, /\| Changed files \| 1 file \|/]) assert.match(commit, pattern);
});

test('the ratings table has one row for each category with its rating or Unassessed, and its completed evidence as x of y', () => {
  const table = rows(section(renderReport(results()), 'Ratings'));
  assert.equal(table.length, 5, 'a header and four categories, with no total row');
  assert.match(table[0], /^\| Category \| Rating \| Required checks completed \| Optional checks completed \| Reason \|$/);
  assert.match(table[1], /^\| Structural Integrity \| 1 of 5 \(Failing\) \| 2 of 3 \| 0 of 0 \| A fundamental failure gives 1 of 5: the head has a NEW ARCH-RULE finding\. \|$/);
  assert.match(table[2], /^\| Verification Coverage \| Unassessed \| 0 of 1 \| 0 of 0 \| .*Missing evidence: a bound head test report, a bound line-coverage report\. \|$/);
  assert.match(table[3], /^\| Behavioral Confidence \| Unassessed \| 0 of 1 \| 0 of 1 \|/);
  assert.match(table[4], /^\| Change Completeness \| 2 of 5 \(Weak\) \| 1 of 1 \| .* \| 3 of 5 needs each level-3 condition\. These conditions are not met: the check "Code-map settings unchanged" passes \(level 3\)\. \|$/);
  assert.match(section(renderReport(results()), 'Ratings')[1], /readiness does not use the rating values\. Readiness uses only two facts of a rating:/);
  const notApplicable = rows(section(renderReport(results({ ratings: { ...results().ratings, behavioralConfidence: rating({ state: 'NOT_APPLICABLE', label: 'Not applicable', reason: 'No behavior changed.' }) } })), 'Ratings'));
  assert.match(notApplicable[3], /^\| Behavioral Confidence \| Not applicable \|/);
});

test('each rating reason names its open conditions in plain words, and a 3 of 5 without level-4 conditions does not say that they are unmet', () => {
  const rated = (value, predicates) => rating({ state: 'RATED', value, label: 'Rated', reason: 'Material problems or gaps prevent the level-3 conditions.', minimumEvidenceMet: true, predicates });
  const ratings = { ...results().ratings, structuralIntegrity: rated(2, { met: ['si.imports-classified'], unmet: ['si.rules-declared'], unknown: ['obligation:si.types', 'vc.changed-lines-80'] }),
    changeCompleteness: rated(3, { met: ['obligation:cc.settings', 'cc.no-hidden-importers'], unmet: [], unknown: [] }) };
  const table = rows(section(renderReport(results({ ratings })), 'Ratings'));
  assert.match(table[1], /\| 3 of 5 needs each level-3 condition\. These conditions are not met: the project declares architecture rules \(level 4\)\. Code-map cannot tell whether these conditions are met: the check "Types are compatible" passes \(level 3\) and the tests ran at least 80% of the changed lines \(level 3\)\. \|$/);
  assert.match(table[4], /\| All conditions up to level 3 are met\. This rule set has no level-4 condition for this category, so 3 of 5 is the highest rating that it can give\. \|$/);
  assert.doesNotMatch(table.join('\n'), /Material problems|not all met|si\.|cc\.|obligation:/);
});

test('failed checks come first when they block, and each one names its evidence and its next action', () => {
  const failed = section(renderReport(results()), 'Failed checks'), table = rows(failed);
  assert.match(failed.join('\n'), /2 checks failed/); assert.equal(table.length, 3);
  assert.match(table[1], /^\| No new architecture-rule break \(`si\.arch-rule`\), Structural Integrity \| Blocks the change \| The head has a NEW ARCH-RULE finding\. Evidence: `ARCH-RULE-0123456789`\. \| `code-map inspect --analysis A-2222222222222222 .*--rule ARCH-RULE` \|$/);
  assert.match(table[2], /^\| Code-map settings unchanged \(`cc\.settings`\), Change Completeness \| Required, does not block \| .*Evidence: `\.code-map\.json`\. \| Undo the edit of \.code-map\.json, or ask a person to review it\. \|$/);
});

test('unknown checks include open, skipped and ineligible results with how to resolve them, and passed or not-applicable checks are not listed', () => {
  const markdown = renderReport(results()), unknown = section(markdown, 'Unknown checks'), table = rows(unknown);
  for (const pattern of [/3 checks have no result/, /7 checks in total: 2 failed, 3 unknown, 1 passed and 1 not applicable/]) assert.match(markdown, pattern);
  assert.deepEqual(table.slice(1).map((row) => row.match(/\(`([^`]+)`\)/)[1]), ['vc.head-run', 'bc.earlier', 'cc.docs']);
  assert.match(table[1], /\| Required, does not block \| There is no bound head report\. \| Add a JUnit report and its run manifest to reportInputs in the request\. \|$/);
  assert.match(table[2], /\| Optional \| .* \| No next action is known yet\. \|$/);
  assert.doesNotMatch(unknown.join('\n'), /si\.imports|si\.types/);
});

test('when no check failed or is unknown, the report says so instead of an empty table', () => {
  const markdown = renderReport(results({ readiness: state('READY'), obligations: [check('si.imports', { result: 'PASS', eligible: true })] })), failed = section(markdown, 'Failed checks');
  assert.deepEqual(rows(failed), []);
  assert.match(failed.join('\n'), /No check failed\./);
  assert.match(section(markdown, 'Unknown checks').join('\n'), /Every check has a result\./);
});

test('the test-report table labels a bound report as self-attested, shows no snapshot and no kind for a report that is not bound, and names the manifest errors', () => {
  const executions = [{ artifact: 'reports/base.xml', kind: 'junit', side: 'base', binding: 'BOUND', attestation: 'self-attested', eligible: true, reasons: [], cases: 4, failed: 1 },
    { artifact: 'reports/bad.xml', kind: null, side: 'head', binding: 'UNBOUND', eligible: false, cases: null, failed: null,
      reasons: [{ key: 'manifest', message: 'The run manifest is invalid (1 error).', errors: [{ path: 'schemaVersion', message: 'Must be the integer 1.' }] }] }];
  const table = rows(section(renderReport(results({ executions })), 'What Code-map compared')).slice(-2);
  assert.match(table[0], /^\| `reports\/base\.xml` \(junit\) \| Base \| Yes, self-attested \| 4, 1 failed \| The run manifest matches the analyzed code\. \|$/);
  assert.match(table[1], /^\| `reports\/bad\.xml` \| Not bound \| No \| Unknown \| The run manifest is invalid \(1 error\)\. The field `schemaVersion`: Must be the integer 1\. \|$/);
});

test('analyses that are not comparable are explained with their reasons', () => {
  const markdown = renderReport(results({ comparison: { state: 'NOT_COMPARABLE', reasons: ['analyzer', 'worktree-changed', 'other-reason'] } }));
  const row = section(markdown, 'What Code-map compared').find((line) => line.startsWith('| Comparison |'));
  for (const pattern of [/The two analyses are not comparable/, /different Code-map versions/, /the working tree changed after the head analysis/, /`other-reason`/, /checks that use findings are UNKNOWN/]) assert.match(row, pattern);
});

test('the limits say that the evidence is static and that no project code ran, and list the rule-set limits and the evidence gaps', () => {
  const limits = section(renderReport(results()), 'Limits').join('\n');
  for (const pattern of [/static evidence only/, /ran no project code/, /run manifest/, /The rule set `static-baseline-v0` cannot assess these items yet:\n\n- Verification Coverage needs a bound line-coverage report/,
    /- Dynamic imports with a computed target are not resolved\. Count: 2\./]) assert.match(limits, pattern);
});

test('the report explains its terms and points to verification-results.json', () => {
  const markdown = renderReport(results()), terms = ['Base', 'Head', 'Snapshot', 'Rule set', 'Check', 'Required check', 'Optional check', 'Blocking check', 'Eligible result', 'Evidence ID', 'Finding',
    'NEW, EXISTING, RESOLVED, UNKNOWN', 'Bound test report', 'Self-attested', 'Unfiltered run', 'Readiness', 'Level condition', 'Unassessed', 'ARCH-RULE'];
  for (const term of terms) assert.match(section(markdown, 'Terms in this report').join('\n'), new RegExp(`\\| ${term} \\| [A-Z]`), term);
  assert.doesNotMatch(markdown, /\| TEST-FOCUSED \|/, 'a finding rule that the report does not name has no row');
  assert.match(section(markdown, 'Full results').join('\n'), /\[verification-results\.json\]\(\.\/verification-results\.json\)/);
});

test('long lists show at most 20 checks each with a count of the rest, and the report stays within 200 lines', () => {
  const many = (prefix, count, fields) => Array.from({ length: count }, (_, index) => check(`${prefix}.${index}`, fields(index)));
  const markdown = renderReport(results({ intent: `A long intent\nwith ${'many words '.repeat(200)}`,
    obligations: [...many('f', 45, () => ({ result: 'FAIL', eligible: true, evidenceIds: Array.from({ length: 30 }, (_, index) => `E-${index}`) })), ...many('u', 45, () => ({}))],
    limits: Array.from({ length: 30 }, (_, index) => `Limit ${index}.`), gaps: Array.from({ length: 30 }, (_, index) => ({ key: `g${index}`, source: 'graph', text: `Gap ${index}.` })),
    executions: Array.from({ length: 30 }, (_, index) => ({ artifact: `r${index}.xml`, kind: 'junit', side: 'head', binding: 'BOUND', eligible: true, reasons: [], cases: 3, failed: 0 })) }));
  const lines = markdown.split('\n');
  assert.ok(lines.length <= 200, `${lines.length} lines`);
  for (const heading of ['Failed checks', 'Unknown checks']) assert.equal(rows(section(markdown, heading)).length, 21, heading);
  for (const what of ['failed', 'unknown']) assert.match(markdown, new RegExp(`The table lists 20 of 45 ${what} checks\\. The other 25 are in verification-results\\.json\\.`));
  assert.match(markdown, /`E-4`, and 25 more/);
  assert.ok(lines[0].length < 140, 'the title keeps a short form of the intent');
});

test('text from the request or the evidence cannot break the Markdown structure or add HTML', () => {
  const markdown = renderReport(results({ intent: 'Fix | the <script>alert(1)</script>\n# heading',
    obligations: [check('x|`y`', { title: 'A | B', rationale: 'Line one\nline two | three', evidenceIds: ['a|b', 'c`d'], nextAction: 'code-map inspect --file "a|b"' })],
    executions: [{ artifact: 'r|`x`.xml', kind: 'junit', side: 'base', binding: 'UNBOUND', eligible: false, reasons: ['No | manifest'], cases: 0, failed: 0 }] }));
  assert.equal(markdown.split('\n')[0], '# Verification report: Fix \\| the \\<script\\>alert(1)\\</script\\> # heading');
  assert.doesNotMatch(markdown, /<script>/);
  for (const heading of ['What Code-map compared', 'Ratings', 'Unknown checks']) {
    const tables = section(markdown, heading).join('\n').split(/\n(?!\|)/).map((block) => block.split('\n').filter((line) => line.startsWith('|'))).filter((block) => block.length);
    assert.ok(tables.length >= 1, heading);
    for (const block of tables) for (const row of block) assert.equal(cells(row), cells(block[0]), `${heading}: ${row}`);
  }
  assert.match(markdown, /``c`d``/);
});

test('the fixed text of the report follows the writing rules: no semicolons, no em dashes and no hedge words', () => {
  for (const name of Object.keys(exitCodes)) {
    const markdown = renderReport(results({ readiness: state(name), comparison: { state: 'NOT_COMPARABLE', reasons: ['analyzer', 'config', 'environment', 'roots', 'repository', 'freshness-unknown', 'worktree-changed'] } }));
    assert.doesNotMatch(markdown, /[;—]/, name);
    assert.doesNotMatch(markdown, /\b(should|may|might|could)\b/i, name);
  }
});

test('the Terms table explains minimum evidence and predicates, and the run manifest by what it records', () => {
  const text = terms.map(([term, meaning]) => `${term}: ${meaning}`).join('\n');
  assert.match(text, /^Minimum evidence: /m);
  assert.match(text, /calls a condition a predicate/);
  assert.match(text, /^Run manifest: .*configuration digest/m);
  assert.doesNotMatch(text, /records the commit, the changed files/);
  assert.equal(comparisonReasons['renames-unavailable'], 'Git cannot list the renames between the base and the head');
});
