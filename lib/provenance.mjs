// Oracle provenance (C37): where the expected result of each test case that a bound head report ran comes from. An oracle is
// the value or condition that an assertion checks. A case is "spec-linked" when its name or a comment directly above it names
// an acceptance criterion of the request with [AC:<id>] or "@ac <id>". Otherwise it is "pre-existing" when the base has the same
// case (the file through renames, the suite, the name and the assertion count) and the change did not edit its text,
// "changed-with-change" when the change added or edited it, and "unknown" when Code-map cannot tell.
// The labels describe the evidence. static-baseline-v0 changes no result because of them: the acceptance checks stay UNKNOWN,
// and only their rationale, next action and evidence IDs name the linked cases (criterionChecks).
// Read-only: it reads test files of the head and the base through Git or the working tree, and TypeScript parses each file alone.
import { join } from 'node:path';
import ts from 'typescript';
import { git, sourceReader } from './git.mjs';
import { scanText } from './assertion-compare.mjs';
import { isTest } from './project.mjs';
import { caseName } from './profiles/static-baseline-v0.mjs';
import { readLimited } from './verify-reports.mjs';

export const provenanceLabels = ['spec-linked', 'pre-existing', 'changed-with-change', 'unknown'];
/** The results list at most 50 cases of each label, 20 cases of each criterion and 20 unknown criterion IDs. The counts include all cases. */
export const provenanceLimits = { cases: 50, criterionCases: 20, unknownCriteria: 20, evidence: 50, assertions: 200, assertionFiles: 20, implementationFiles: 50 };
const policy = 'Code-map records where the expected result of each test case comes from. static-baseline-v0 does not change a check, a rating or the readiness because of a label.';
const tags = [/\[AC:([A-Za-z0-9._-]{1,64})\]/g, /@ac[ \t]+([A-Za-z0-9._-]{1,64})(?![A-Za-z0-9._-])/g], marker = /\[AC:|@ac[ \t]/;
const maxTestBytes = 8 * 1024 * 1024, named = 3;
const kinds = { '.ts': ts.ScriptKind.TS, '.mts': ts.ScriptKind.TS, '.cts': ts.ScriptKind.TS, '.tsx': ts.ScriptKind.TSX, '.jsx': ts.ScriptKind.JSX };
const plural = (count, one, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;
const tagsOf = (text) => tags.flatMap((pattern) => [...String(text).matchAll(pattern)].map((match) => match[1]));
const reasons = { file: 'The report gives no file for this case, so Code-map cannot find it in the analyses.', missing: 'The head analysis has no test case with this name in this file.',
  many: 'The head analysis has more than one test case with this name in this file.', text: 'Code-map cannot find the text of this case in the base or in the head.',
  scan: 'The base analysis has no test scan, so Code-map cannot tell whether the base has this case.' };

/** The test cases of an analysis by path. The ID of a case is its path after `rename`, its suite, its name and its ordinal among equal names, as in verify-change.mjs. */
function indexed(cases, rename) {
  const seen = new Map(), byPath = new Map();
  for (const entry of cases) {
    const key = JSON.stringify([entry.path, entry.suite ?? '', entry.name]), ordinal = seen.get(key) ?? 0;
    seen.set(key, ordinal + 1);
    if (!byPath.has(entry.path)) byPath.set(entry.path, []);
    byPath.get(entry.path).push({ path: entry.path, entry, full: entry.suite ? `${entry.suite} > ${entry.name}` : entry.name, id: JSON.stringify([rename(entry.path), entry.suite ?? '', entry.name, ordinal]) });
  }
  return byPath;
}

/** The head case of a report case: the same file, and the report name, or its suite and name, equal to the suite and name of the case. */
function matchCase(entry, heads) {
  if (entry.file === null || entry.file === undefined) return { reason: reasons.file };
  const names = new Set([entry.name, ...(entry.suite && entry.suite !== entry.file ? [`${entry.suite} > ${entry.name}`] : [])]);
  const found = (heads.get(entry.file) ?? []).filter((item) => names.has(item.full));
  return found.length === 1 ? { found: found[0] } : { reason: found.length ? reasons.many : reasons.missing };
}

/** The texts of these files on one side: from the working tree for a working-tree head, else from its commit. A file that Code-map cannot read is left out. */
function texts(repository, side, all) {
  // The Git batch read takes one path for each line, so a path with a line break is left out.
  const paths = all.filter((path) => !/[\n\r]/.test(path));
  if (!paths.length) return new Map();
  if (!side.worktree) return sourceReader(repository, side.sha).read(paths);
  return new Map(paths.flatMap((path) => { try { return [[path, readLimited(join(repository, path), maxTestBytes, 'test file').toString('utf8')]]; } catch { return []; } }));
}

/** The calls of one test file by the line where each one starts. TypeScript reads the file alone, without a program. */
function callsOf(path, text) {
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, kinds[/\.[^.]+$/.exec(path)?.[0]] ?? ts.ScriptKind.JS), byLine = new Map();
  const visit = (node) => {
    if (ts.isCallExpression(node) && node.arguments.length) {
      const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
      if (!byLine.has(line)) byLine.set(line, []);
      byLine.get(line).push(node);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return { source, text, byLine };
}

/** The call of a scanned case: its line and the name of its first argument, as test-scan.mjs reads them. A call inside it with the same name loses to the outer call. */
function caseCall(parsed, entry) {
  const label = (node) => ts.isStringLiteralLike(node) ? node.text : node.getText(parsed.source).replace(/\s+/g, ' ').slice(0, 160);
  const found = (parsed.byLine.get(entry.line) ?? []).filter((node) => label(node.arguments[0]) === entry.name);
  return found.sort((a, b) => a.getStart(parsed.source) - b.getStart(parsed.source) || b.end - a.end)[0] ?? null;
}

/** The comments directly above a case: the last comments before its line, with no empty line between them and the case. */
function commentsAbove({ source, text }, node) {
  const lineAt = (position) => source.getLineAndCharacterOfPosition(position).line, line = lineAt(node.getStart(source));
  let holder = node;
  while (holder.parent && !ts.isSourceFile(holder.parent) && lineAt(holder.parent.getStart(source)) === line) holder = holder.parent;
  const block = [];
  let next = line;
  for (const range of [...(ts.getLeadingCommentRanges(text, holder.pos) ?? [])].reverse()) {
    if (lineAt(range.end) < next - 1) break;
    block.unshift(text.slice(range.pos, range.end));
    next = lineAt(range.pos);
  }
  return block.join('\n');
}

/**
 * The provenance of each case that a bound head report ran (`reports` is the list of eligible head test reports). `head` and `base`
 * are { sha, worktree, analysis }, `change` comes from changedFiles and changedPaths, and `renames` from the comparison. It returns the
 * `provenance` section of the results and the evidence ID of each case, for the check of the hypotheses.
 */
export function oracleProvenance(repository, { request, reports, head, base, change, renames = [] }) {
  const known = new Set(request.acceptanceCriteria.map((item) => item.id));
  const moves = new Map([...change.files.filter((file) => file.status === 'R' && file.from).map((file) => [file.from, file.path]), ...renames.map((item) => [item.from, item.to])]);
  const sources = new Map([...moves].map(([from, to]) => [to, from])), changed = new Set(change.paths), baseOf = (path) => sources.get(path) ?? path;
  const heads = indexed(head.analysis.tests?.cases ?? [], (path) => path);
  const byId = new Map([...indexed(base.analysis.tests?.cases ?? [], (path) => moves.get(path) ?? path).values()].flat().map((item) => [item.id, item]));
  const runs = reports.flatMap((report) => report.cases.filter((entry) => entry.status !== 'skipped').map((entry) => ({ report, entry, ...matchCase(entry, heads) })));
  for (const run of runs) if (run.found) {
    run.base = byId.get(run.found.id) ?? null;
    // A file that the change did not touch is the same in the base and the head, so only a case of a changed file needs a text comparison.
    run.compare = run.base !== null && run.base.entry.assertions === run.found.entry.assertions && (changed.has(run.found.path) || sources.has(run.found.path));
  }
  const headTexts = texts(repository, head, [...new Set(runs.filter((run) => run.found).map((run) => run.found.path))]);
  const baseTexts = texts(repository, base, [...new Set(runs.filter((run) => run.compare).map((run) => baseOf(run.found.path)))]);
  const caches = [new Map(), new Map()], tagged = new Map();
  const parsed = (side, path) => {
    const [cache, all] = side === 'head' ? [caches[0], headTexts] : [caches[1], baseTexts];
    if (!cache.has(path)) cache.set(path, all.has(path) ? callsOf(path, all.get(path)) : null);
    return cache.get(path);
  };
  const hasTags = (path) => { if (!tagged.has(path)) tagged.set(path, headTexts.has(path) && marker.test(headTexts.get(path))); return tagged.get(path); };
  const origin = (run, call) => {
    if (!run.found) return ['unknown', run.reason];
    if (!base.analysis.tests) return ['unknown', reasons.scan];
    if (!run.base || run.base.entry.assertions !== run.found.entry.assertions) return ['changed-with-change'];
    if (!run.compare) return ['pre-existing'];
    const before = parsed('base', baseOf(run.found.path)), old = before && caseCall(before, run.base.entry);
    if (!call || !old) return ['unknown', reasons.text];
    return [call.getText(parsed('head', run.found.path).source) === old.getText(before.source) ? 'pre-existing' : 'changed-with-change'];
  };
  const entries = runs.map((run) => {
    const { entry, found } = run, file = found && (run.compare || hasTags(found.path)) ? parsed('head', found.path) : null, call = file && caseCall(file, found.entry);
    const ids = [...new Set([...tagsOf(found ? found.entry.name : entry.name), ...(call && hasTags(found.path) ? tagsOf(commentsAbove(file, call)) : [])])];
    const criteria = ids.filter((id) => known.has(id)), [from, reason] = origin(run, call);
    return { evidenceId: `case:${run.report.artifact}:${caseName(entry)}`, caseName: caseName(entry), file: entry.file ?? null, suite: entry.suite ?? null, name: entry.name, status: entry.status,
      label: criteria.length ? 'spec-linked' : from, origin: from, ...(criteria.length ? { criteria } : {}), ...(reason ? { reason } : {}), unknownTags: ids.filter((id) => !known.has(id)) };
  });
  return { section: { ...summarize(entries, request.acceptanceCriteria), ...assertionProvenance(repository, head, runs, entries, headTexts) }, entries, caseIds: entries.map((entry) => entry.evidenceId) };
}

/** Bounded assertion origins. Git authorship is a claim, never an independent oracle confirmation. */
function assertionProvenance(repository, head, runs, entries, headTexts) {
  const assertions = [], scanned = new Map(), changes = new Map(), blamed = new Map();
  let truncated = false;
  for (const [index, run] of runs.entries()) {
    if (!run.found || !headTexts.has(run.found.path)) continue;
    const path = run.found.path;
    if (!scanned.has(path)) {
      if (scanned.size >= provenanceLimits.assertionFiles) { truncated = true; continue; }
      scanned.set(path, scanText(path, headTexts.get(path)));
    }
    const entry = run.found.entry, test = scanned.get(path).find((item) => item.line === entry.line && item.name === entry.name && item.suite === (entry.suite ?? ''));
    for (const check of test?.checks ?? []) {
      if (assertions.length >= provenanceLimits.assertions) { truncated = true; break; }
      let author = null, commit = null, reason;
      try {
        const key = `${path}:${check.line}`, args = ['blame', '--line-porcelain', '-L', `${check.line},${check.line}`];
        if (!blamed.has(key)) blamed.set(key, head.worktree
          ? git(repository, [...args, '--contents', '-', '--', path], headTexts.get(path))
          : git(repository, [...args, head.sha, '--', path]));
        const blame = blamed.get(key);
        const sha = blame.split(' ')[0];
        if (/^0+$/.test(sha)) reason = 'The assertion line is uncommitted.';
        else { commit = sha; author = /^author (.*)$/m.exec(blame)?.[1] ?? null; }
      } catch { reason = 'Git cannot attribute this assertion line.'; }
      if (commit && !changes.has(commit)) {
        try {
          const files = git(repository, ['diff-tree', '--root', '--no-commit-id', '--name-only', '-r', '-z', commit]).split('\0').filter((file) => file && !isTest(file));
          changes.set(commit, { files: files.slice(0, provenanceLimits.implementationFiles), truncated: files.length > provenanceLimits.implementationFiles });
        } catch { changes.set(commit, { files: [], truncated: false, reason: 'Git cannot read the associated commit changes.' }); }
      }
      const associated = changes.get(commit);
      assertions.push({ evidenceId: entries[index].evidenceId, file: path, line: check.line, text: check.text,
        specification: entries[index].criteria?.[0] ?? null, specifications: entries[index].criteria ?? [], author, commit,
        implementationChanges: associated?.files ?? [], implementationChangesTruncated: associated?.truncated ?? false,
        trust: 'unconfirmed', ...(reason || associated?.reason ? { reason: reason ?? associated.reason } : {}) });
    }
  }
  return { assertions, assertionLimits: { assertions: provenanceLimits.assertions, files: provenanceLimits.assertionFiles,
    implementationFiles: provenanceLimits.implementationFiles }, assertionsTruncated: truncated };
}

/** The counts, the capped lists of each label, the linked cases of each criterion and the unknown criterion IDs. */
function summarize(entries, criteria) {
  const { cases: max, criterionCases, unknownCriteria } = provenanceLimits, shown = ({ unknownTags: _, caseName: __, ...entry }) => entry;
  const unknown = new Map();
  for (const entry of entries) for (const id of entry.unknownTags) unknown.set(id, (unknown.get(id) ?? 0) + 1);
  return { policy, total: entries.length, counts: Object.fromEntries(provenanceLabels.map((label) => [label, entries.filter((entry) => entry.label === label).length])),
    cases: Object.fromEntries(provenanceLabels.map((label) => [label, entries.filter((entry) => entry.label === label).slice(0, max).map(shown)])),
    criteria: criteria.map(({ id }) => {
      const linked = entries.filter((entry) => entry.criteria?.includes(id)), passed = linked.filter((entry) => entry.status === 'passed'), failed = linked.filter((entry) => entry.status !== 'passed');
      // The list keeps the passed cases first, and at least half of its places for failed cases, so that the rationale can name both.
      const failures = Math.min(failed.length, Math.max(criterionCases / 2, criterionCases - passed.length));
      return { id, linked: linked.length, passed: passed.length, failed: failed.length, cases: [...passed.slice(0, criterionCases - failures), ...failed.slice(0, failures)]
        .map((entry) => ({ evidenceId: entry.evidenceId, caseName: entry.caseName, status: entry.status, origin: entry.origin })) };
    }),
    unknownCriteria: [...unknown].slice(0, unknownCriteria).map(([id, cases]) => ({ id, cases })) };
}

/**
 * The acceptance checks with the test cases that name their criterion. Each check keeps its result (UNKNOWN), its flags and its
 * applicability: a linked case that passed does not confirm its expected result. Its rationale and evidence IDs name the linked cases.
 */
export function criterionChecks(obligations, provenance) {
  const byId = new Map((provenance?.criteria ?? []).map((entry) => [`acceptance.${entry.id}`, entry]));
  const list = (cases, total) => `${cases.slice(0, named).map((entry) => entry.caseName).join(', ')}${total > named ? `, and ${total - named} more` : ''}`;
  return obligations.map((item) => {
    const entry = byId.get(item.id);
    if (!entry) return item;
    if (!entry.linked) return { ...item, rationale: `${item.rationale} No test case of the bound head reports names this criterion with [AC:${entry.id}] or @ac ${entry.id}.`,
      nextAction: `Add [AC:${entry.id}] to the name of the test case of this criterion, or to a comment directly above the case, and add a bound head report of its run. ${item.nextAction ?? ''}`.trim() };
    const passed = entry.cases.filter((point) => point.status === 'passed'), failed = entry.cases.filter((point) => point.status !== 'passed');
    const text = [entry.passed ? `${plural(entry.passed, 'linked test case')} passed in the bound head reports: ${list(passed, entry.passed)}.` : 'No linked test case passed in the bound head reports.',
      entry.failed ? `${plural(entry.failed, 'linked test case')} failed: ${list(failed, entry.failed)}.` : '', 'A linked case does not confirm its expected result, so the check stays UNKNOWN.'];
    return { ...item, rationale: `${item.rationale} ${text.filter(Boolean).join(' ')}`,
      evidenceIds: [...new Set([...item.evidenceIds, ...entry.cases.map((point) => point.evidenceId)])].slice(0, provenanceLimits.evidence) };
  });
}
