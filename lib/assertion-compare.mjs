// The assertion-level comparison of the test cases that a change kept (C27). For a case of the base and the head, it finds
// fewer assertions, a strict matcher that the head replaces with a looser one, and a removed expect.assertions() or
// expect.hasAssertions(). A changed expected value is not weakening. Pure: TypeScript parses the two texts, and nothing runs.
import ts from 'typescript';
import { createHash } from 'node:crypto';
import { scriptKind } from './analyze.mjs';
import { localChecker } from './source-metrics.mjs';
import { scanTests } from './test-scan.mjs';
import { caseIdentities } from './verify-change.mjs';

const strictExpect = new Set(['toBe', 'toEqual', 'toStrictEqual']), throwMatcher = /^(toThrow|toThrowError)$/;
const looseExpect = new Set(['toBeTruthy', 'toBeDefined', 'toMatchObject']), looseNegated = new Set(['toBeNull', 'toBeUndefined']);
const equalAsserts = new Set(['equal', 'strictEqual', 'deepEqual', 'deepStrictEqual']);
const shownRemoved = 3;
const running = (item) => ['active', 'focused', 'expected-failure'].includes(item.status);

/** The cases of one test file text with the details of their assertions (scanTests with details). */
export function scanText(path, text) {
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, scriptKind(path));
  return scanTests(source, localChecker(source), () => null, { details: true, fullPlans: true }).cases;
}

/** Whether the head version of one assertion checks less than the base version. Both have the same family and subject. */
function looser(base, head) {
  if (head.anything && !base.anything) return true;
  if (base.family === 'expect') {
    const strict = !base.negated && (strictExpect.has(base.matcher) || (throwMatcher.test(base.matcher) && base.expected > 0));
    if (!strict) return false;
    if (head.negated) return looseNegated.has(head.matcher);
    return looseExpect.has(head.matcher) || (throwMatcher.test(head.matcher) && head.expected === 0) || (base.matcher === 'toStrictEqual' && head.matcher === 'toEqual');
  }
  return base.family === 'assert' && ((equalAsserts.has(base.matcher) && head.matcher === 'ok') || (base.matcher === 'strictEqual' && head.matcher === 'equal')
    || (base.matcher === 'deepStrictEqual' && head.matcher === 'deepEqual'));
}

/**
 * The weakening entries of one case that the base and the head have: [{ kind, base: { assertions, text }, head: { assertions, text } }].
 * An assertion with the same full text in both versions stays. Then each other base assertion pairs with the first head assertion
 * of its family and subject. A base assertion without a pair is removed.
 */
function compareCase(base, head) {
  const exact = new Map();
  for (const check of head.checks) exact.set(check.key, (exact.get(check.key) ?? 0) + 1);
  const unmatched = base.checks.filter((check) => { const left = exact.get(check.key) ?? 0; if (left) exact.set(check.key, left - 1); return !left; });
  const rest = new Map();
  for (const check of head.checks) {
    if (!exact.get(check.key)) continue;
    exact.set(check.key, exact.get(check.key) - 1);
    const key = `${check.family}\0${check.subjectKey}`;
    rest.set(key, [...(rest.get(key) ?? []), check]);
  }
  const entries = [], removed = [], counts = (text, other) => ({ base: { assertions: base.assertions, text }, head: { assertions: head.assertions, text: other } });
  for (const check of unmatched) {
    const pair = check.subjectKey ? rest.get(`${check.family}\0${check.subjectKey}`)?.shift() : undefined;
    if (!pair) removed.push(check.text);
    else if (looser(check, pair)) entries.push({ kind: 'looser-matcher', ...counts(check.text, pair.text) });
  }
  if (head.assertions < base.assertions) {
    const more = removed.length > shownRemoved ? [`and ${removed.length - shownRemoved} more`] : [];
    entries.push({ kind: 'fewer-assertions', ...counts(removed.length ? [...removed.slice(0, shownRemoved), ...more].join(' | ').slice(0, 160) : null, null) });
  }
  if (base.plans.length && !head.plans.length) entries.push({ kind: 'plan-removed', ...counts(base.plans[0].slice(0, 160), null) });
  return entries;
}

/**
 * The weakening entries of one changed test file. A case counts when the base and the head have it (the same path after the
 * rename, suite, name and ordinal) and it runs in both: a skipped head case is a TEST-PARKED finding, and an added case is new.
 */
export function compareTestFile({ basePath, baseText, headPath, headText }) {
  const identities = (cases, path, rename) => caseIdentities(cases.map((item) => ({ ...item, path })), rename);
  const base = new Map(identities(scanText(basePath, baseText), basePath, (path) => (path === basePath ? headPath : path)).map(({ item, id }) => [id, item]));
  const entries = [];
  for (const { item, id } of identities(scanText(headPath, headText), headPath, (path) => path)) {
    const old = base.get(id);
    if (!old || !running(old)) continue;
    const expectedFailure = item.expectedFailure && !old.expectedFailure;
    if (!running(item) && !expectedFailure) continue;
    const changes = expectedFailure ? [{ kind: 'expected-failure', base: { assertions: old.assertions, text: old.status },
      head: { assertions: item.assertions, text: item.status } }] : [];
    for (const [index, found] of [...changes, ...compareCase(old, item)].entries()) {
      const identity = [basePath, ...JSON.parse(id).slice(1), found.kind, index,
        old.checks.map((x) => x.key), item.checks.map((x) => x.key), old.plans, item.plans];
      const entryId = `weakening:${createHash('sha256').update(JSON.stringify(identity)).digest('hex')}`;
      entries.push({ id: entryId, kind: found.kind, path: headPath, basePath, suite: item.suite, name: item.name, line: item.line, baseLine: old.line, base: found.base, head: found.head });
    }
  }
  return entries;
}
