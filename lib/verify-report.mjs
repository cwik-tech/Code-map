// The output of one verification run: verification-report.md for a person and verification-results.json for a tool.
// renderReport is pure. writeRun stages both files in a private folder, moves that folder into place and only then replaces
// latest.json, the completion manifest. A run that fails leaves no folder behind and does not change latest.json.
import { createHash, randomBytes } from 'node:crypto';
import { lstatSync, mkdirSync, mkdtempSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { isInside, realPath } from './inspect.mjs';
import { categories, evidenceCompleteness, exitCode } from './ratings.mjs';
import { rootProblem } from './store.mjs';
import { comparisonReasons, conditions, findingRules, meanings, names, questions, terms } from './verify-words.mjs';

export const fileNames = { results: 'verification-results.json', report: 'verification-report.md', manifest: 'latest.json' };
/** The report lists at most this many checks in each list, and this many reports, limits or gaps. The JSON file has all of them. */
export const listLimit = 20, itemLimit = 10;

const isRecord = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);
const plural = (count, one, many) => `${count} ${count === 1 ? one : many}`;
/** One line of text: control characters and line breaks become spaces, and a long value is cut at `max` characters. */
const flat = (value, max) => { const text = String(value ?? '').replace(/[\u0000-\u001f\u007f\s]+/g, ' ').trim(); return text.length > max ? `${text.slice(0, max - 3).trimEnd()}...` : text; };
/** Escapes the Markdown and HTML characters, so that a value cannot add a table cell, a link, emphasis or a tag. */
const plain = (value, max = 400) => flat(value, max).replace(/[\\`*_[\]<>|]/g, '\\$&');
/** A code span with a fence that is longer than each backtick run inside. "|" stays escaped, because tables split cells on it even in code. */
const code = (value, max = 200) => {
  const text = flat(value, max) || 'none', fence = '`'.repeat(Math.max(0, ...(text.match(/`+/g) ?? []).map((run) => run.length)) + 1), pad = /^`|`$/.test(text) ? ' ' : '';
  return `${fence}${pad}${text.replace(/\|/g, '\\|')}${pad}${fence}`;
};
const table = (header, body) => [`| ${header.join(' | ')} |`, `| ${header.map(() => '---').join(' | ')} |`, ...body.map((row) => `| ${row.join(' | ')} |`)];
const rest = (shown, total, what) => total > shown ? [`The table lists ${shown} of ${total} ${what}. The other ${total - shown} are in ${fileNames.results}.`] : [];
const bullets = (items, total, what) => [...items.map((item) => `- ${item}`), ...(total > items.length ? ['', `${total - items.length} more ${what} are in ${fileNames.results}.`] : [])];
const count = (value) => Array.isArray(value) ? value.length : Number.isInteger(value) ? value : null;
/** "a", "a and b", "a, b and c", or the first `max` items and "and N more". */
const series = (items, max = items.length, shown = items.slice(0, max)) => items.length > max ? `${shown.join(', ')} and ${items.length - max} more`
  : shown.length > 1 ? `${shown.slice(0, -1).join(', ')} and ${shown.at(-1)}` : shown[0] ?? '';

/** PASS and FAIL count only from an eligible check, as in ratings.mjs. */
const effective = (item) => (item.result === 'PASS' || item.result === 'FAIL') && !item.eligible ? 'UNKNOWN' : item.result;
const weight = (item) => item.blocking ? 0 : item.required ? 1 : 2;
function sortChecks(obligations) {
  const live = obligations.filter((item) => item.applicability !== 'NOT_APPLICABLE');
  const failed = live.filter((item) => effective(item) === 'FAIL');
  const unknown = live.filter((item) => effective(item) !== 'FAIL' && (item.applicability === 'UNKNOWN' || ['UNKNOWN', 'SKIPPED'].includes(effective(item))));
  const byWeight = (list) => [...list].sort((a, b) => weight(a) - weight(b));
  return { failed: byWeight(failed), unknown: byWeight(unknown), passed: live.length - failed.length - unknown.length, notApplicable: obligations.length - live.length };
}

/** The Markdown report for a person without context. Each list has a limit, so the report has fewer than 200 lines for any results. */
export function renderReport(results) {
  const checks = sortChecks(results.obligations ?? []);
  const body = [`# Verification report: ${plain(results.intent, 100)}`, '', readinessParagraph(results.readiness, checks), '',
    '## What Code-map compared', '', ...compared(results), '', '## Ratings', '', ...ratingLines(results), '',
    '## Failed checks', '', ...failedLines(results, checks), '', '## Unknown checks', '', ...unknownLines(checks), '', '## Limits', '', ...limitLines(results), ''];
  const text = body.join('\n'), rules = Object.entries(findingRules).filter(([id]) => text.includes(id)).map(([id, meaning]) => [id, `A finding rule. ${meaning}`]);
  return [...body, '## Terms in this report', '', ...table(['Term', 'Meaning'], [...terms, ...rules]), '', '## Full results', '', ...fullResults(results), ''].join('\n');
}

function readinessParagraph(readiness, checks) {
  const known = Object.hasOwn(meanings, readiness.state), state = known ? readiness.state : plain(readiness.state);
  const exit = readiness.exitCode ?? exitCode(readiness.state), parts = [];
  const insufficient = readiness.insufficient?.length ?? 0, unrated = readiness.unassessedCategories?.length ?? 0, unsupported = readiness.unsupportedCategories?.length ?? 0;
  if (readiness.state === 'BLOCKED') parts.push(`${plural(readiness.blocking?.length ?? 0, 'blocking check', 'blocking checks')} failed.`);
  if (readiness.state === 'REVIEW') parts.push(`${plural(readiness.review?.length ?? 0, 'check failed without blocking or needs', 'checks failed without blocking or need')} a review.`);
  if (readiness.state === 'INSUFFICIENT_EVIDENCE') {
    const missing = [insufficient && plural(insufficient, 'required check has no result', 'required checks have no result'),
      unrated && plural(unrated, 'required category has no rating', 'required categories have no rating'),
      unsupported && plural(unsupported, 'required category has a rating without its minimum evidence', 'required categories have a rating without their minimum evidence')].filter(Boolean);
    parts.push(missing.length ? `${missing.join(', and ')}.`.replace(/^./, (first) => first.toUpperCase()) : 'The rule set gave no required check, so the assessment is empty.');
    // The failures that do not block are also in the data. A reader of this paragraph alone must see them.
    const failed = checks.failed.filter((item) => item.required).map((item) => code(item.id, 120));
    parts.push(failed.length ? `${plural(failed.length, 'required check', 'required checks')} failed: ${series(failed, 5)}. The section "Failed checks" gives the evidence.`
      : missing.length ? 'No required check failed.' : '', missing.length ? 'The sections "Unknown checks" and "Ratings" name the missing evidence.' : '');
  }
  const meaning = known ? meanings[readiness.state] : 'Code-map did not get a known readiness state.';
  return [`**The readiness of this change is ${state}.**`, meaning, ...parts.filter(Boolean), `\`code-map verify\` exits with code ${exit} for this result.`,
    'The section "Terms in this report" at the end explains the words that this report uses.'].join(' ');
}

function compared(results) {
  const { base, head, change, comparison } = results, executions = results.executions ?? [];
  const at = (side) => `${code(side.ref)} at commit ${code(side.sha)}. Stored analysis ${code(side.analysisId)}.`;
  const reasons = (comparison.reasons ?? []).map((reason) => typeof reason === 'string' ? comparisonReasons[reason] ?? code(reason) : plain(reason?.message ?? JSON.stringify(reason)));
  const eligible = executions.filter((item) => item.eligible).length;
  const rows = [
    ['Intent', plain(results.intent, 500)],
    ['Change type', plain(results.changeType)],
    ['Base', at(base)],
    ['Head', head.ref === 'worktree' ? `The working tree on commit ${code(head.sha)}.${head.worktreeDigest ? ` Working-tree digest ${code(head.worktreeDigest)}.` : ''} Stored analysis ${code(head.analysisId)}.` : at(head)],
    ['Rule set', `${code(results.profileId)} with the rating rules ${code(results.ratingRulesVersion)}`],
    ['Changed files', change.total === 0 ? 'No file changed' : plural(change.total, 'file', 'files')],
    ['Comparison', comparison.state === 'COMPARABLE' ? 'The two analyses are comparable. The same Code-map version, settings and environment made them.'
      : `The two analyses are not comparable: ${reasons.join(', ') || 'Code-map gave no reason'}. As a result, the checks that use findings are UNKNOWN.`],
    ['Test reports', executions.length ? `${plural(executions.length, 'report', 'reports')}. ${eligible ? plural(eligible, 'report counts', 'reports count') : 'No report counts'} as evidence.` : 'The request gave no test report.'],
    ['Request', `The SHA-256 digest of the request is ${code(results.request?.digest)}.`],
    ['Run', `${code(results.runId)}, created at ${plain(results.createdAt)}`],
  ];
  const lines = table(['Item', 'Value'], rows);
  if (!executions.length) return lines;
  // A reason of an invalid manifest can list the fields with errors, so the reader knows what to correct.
  const fields = (reason) => (Array.isArray(reason?.errors) ? reason.errors.slice(0, 3) : []).map((error) => `${error?.path ? `The field ${code(error.path, 100)}` : 'The manifest'}: ${plain(error?.message, 200)}`);
  const message = (reason) => typeof reason === 'string' ? [plain(reason)] : [plain(reason?.message), ...fields(reason)];
  const shown = executions.slice(0, itemLimit).map((item) => {
    const cases = count(item.cases), failed = count(item.failed), binding = typeof item.binding === 'string' ? item.binding : item.binding?.state;
    const why = (item.reasons ?? []).flatMap(message).filter(Boolean).join(' ')
      || (item.eligible ? 'The run manifest matches the analyzed code.' : `The report is not bound to the analyzed code (binding state ${plain(binding ?? 'unknown')}).`);
    return [`${code(item.artifact)}${item.kind ? ` (${plain(item.kind)})` : ''}`, !item.eligible && binding !== 'BOUND' ? 'Not bound' : item.side === 'base' ? 'Base' : 'Head',
      item.eligible ? `Yes, ${plain(item.attestation ?? 'self-attested', 60)}` : 'No', cases === null ? 'Unknown' : `${cases}, ${failed ?? 0} failed`, why];
  });
  return [...lines, '', 'The request gave these test reports. A report counts as evidence only when its run manifest ties it to the analyzed code. '
    + "The project's own test run writes the run manifest, so each report that counts is self-attested.", '',
    ...table(['Report', 'Snapshot', 'Counts as evidence', 'Test cases', 'Reason'], shown), ...(executions.length > itemLimit ? ['', ...rest(itemLimit, executions.length, 'test reports')] : [])];
}

function ratingLines(results) {
  const rows = categories.map((category) => {
    const rating = results.ratings?.[category] ?? { state: 'UNASSESSED', reason: 'The results have no rating for this category.' };
    const counts = rating.evidenceCompleteness ?? evidenceCompleteness(results.obligations ?? [], category);
    const value = rating.state === 'RATED' ? `${rating.value} of 5 (${rating.label})` : rating.state === 'NOT_APPLICABLE' ? 'Not applicable' : 'Unassessed';
    const reason = [...ratingReason(rating, results.obligations ?? []), rating.missingEvidence?.length ? `Missing evidence: ${plain(rating.missingEvidence.join(', '), 400)}.` : '',
      rating.rejectedDisposition ? `Code-map rejected the not-applicable disposition: ${plain(rating.rejectedDisposition, 300)}` : ''].filter(Boolean).join(' ');
    return [names[category], value, `${counts.required.completed} of ${counts.required.total}`, `${counts.optional.completed} of ${counts.optional.total}`, reason];
  });
  return ['Each category has its own rating from 1 (Failing) to 5 (Thorough), or Unassessed when the evidence is not sufficient for a rating. '
    + 'Code-map never adds or averages the ratings, and readiness does not use the rating values. Readiness uses only two facts of a rating: '
    + 'whether a required category has a rating with its minimum evidence, and whether a category has a fundamental failure.', '',
  ...table(['Category', 'Rating', 'Required checks completed', 'Optional checks completed', 'Reason'], rows), '',
  'A check is completed when it has an eligible PASS or FAIL result. A completed FAIL counts as evidence, not as a success. The four categories answer these questions:', '',
  ...categories.map((category) => `- ${names[category]}: ${questions[category]}`)];
}

/** A rating condition in plain words, with its level. A condition "obligation:<id>" is a required check of the category, which level 3 needs. */
function condition(id, obligations) {
  const share = /^vc\.changed-(lines|branches)-(\d+)$/.exec(id), known = Object.hasOwn(conditions, id) ? conditions[id] : null;
  const check = id.startsWith('obligation:') ? id.slice('obligation:'.length) : null, title = obligations.find((item) => item.id === check)?.title;
  if (check !== null) return { level: 3, text: `the check ${title ? `"${plain(title, 100)}"` : code(check, 120)} passes` };
  if (share) return { level: share[1] === 'lines' ? 3 : 4, text: `the tests ran at least ${share[2]}% of the changed ${share[1]}` };
  return known ? { level: known[0], text: known[1] } : { level: null, text: `the condition ${code(id, 120)}` };
}

/** Why a category has its rating: the fundamental failures of 1 of 5, or the conditions that are not met or have no result. */
function ratingReason(rating, obligations) {
  const value = rating.state === 'RATED' && Number.isInteger(rating.value) ? rating.value : null, failures = rating.failures ?? [];
  if (value === null || (value === 1 && !failures.length)) return [plain(rating.reason, 300)];
  if (value === 1) return [`A fundamental failure gives 1 of 5: ${series(failures.map((id) => condition(id, obligations).text), 4)}.`];
  const { unmet = [], unknown = [] } = rating.predicates ?? {}, levels = [...unmet, ...unknown].map((id) => condition(id, obligations).level);
  const named = (ids) => series(ids.map((id) => { const { level, text } = condition(id, obligations); return level ? `${text} (level ${level})` : text; }), 4);
  return [value === 2 ? '3 of 5 needs each level-3 condition.' : `All conditions up to level ${value} are met.`,
    unmet.length ? `These conditions are not met: ${named(unmet)}.` : '', unknown.length ? `Code-map cannot tell whether these conditions are met: ${named(unknown)}.` : '',
    // A level without conditions cannot be reached, so the rating stops below it. That is not an unmet condition.
    value > 2 && value < 5 && !levels.some((level) => level === null || level === value + 1)
      ? `This rule set has no level-${value + 1} condition for this category, so ${value} of 5 is the highest rating that it can give.` : ''];
}

const label = (item) => `${item.title ? `${plain(item.title, 200)} ` : ''}(${code(item.id)}), ${names[item.category] ?? plain(item.category)}`;
const evidence = (item) => {
  const ids = item.evidenceIds ?? [], shown = ids.slice(0, 5).map((id) => code(id, 120));
  return ids.length ? `Evidence: ${shown.join(', ')}${ids.length > 5 ? `, and ${ids.length - 5} more` : ''}.` : '';
};
const action = (item) => !item.nextAction ? 'No next action is known yet.' : /^code-map\s/.test(item.nextAction) ? code(item.nextAction, 400) : plain(item.nextAction);

function failedLines(results, checks) {
  const { failed } = checks, total = (results.obligations ?? []).length;
  const summary = `The rule set gave ${plural(total, 'check', 'checks')} in total: ${failed.length} failed, ${checks.unknown.length} unknown, ${checks.passed} passed and ${checks.notApplicable} not applicable.`;
  if (!failed.length) return [`${summary} No check failed.`];
  const rows = failed.slice(0, listLimit).map((item) => [label(item), item.blocking ? 'Blocks the change' : item.required ? 'Required, does not block' : 'Optional',
    [plain(item.rationale), evidence(item) || 'The check records no evidence ID.'].filter(Boolean).join(' '), action(item)]);
  return [`${summary} ${plural(failed.length, 'check', 'checks')} failed. A failed check has an eligible FAIL result, so Code-map has evidence of the problem.`, '',
    ...table(['Check', 'Effect', 'Reason and evidence', 'Next action'], rows), ...(failed.length > listLimit ? ['', ...rest(listLimit, failed.length, 'failed checks')] : [])];
}

function unknownLines({ unknown }) {
  if (!unknown.length) return ['Every check has a result.'];
  const why = (item) => [item.applicability === 'UNKNOWN' ? 'Code-map cannot tell whether the check applies.' : '', item.result === 'SKIPPED' ? 'Code-map skipped the check.' : '',
    ['PASS', 'FAIL'].includes(item.result) && !item.eligible ? `The result ${item.result} is not eligible, so it counts as UNKNOWN.` : '', plain(item.rationale), evidence(item)].filter(Boolean).join(' ');
  const effect = (item) => `${item.required ? 'Required' : 'Optional'}, ${item.blocking ? 'blocks when it fails' : 'does not block'}`.replace('Optional, does not block', 'Optional');
  const rows = unknown.slice(0, listLimit).map((item) => [label(item), effect(item), why(item), action(item)]);
  return [`${plural(unknown.length, 'check has', 'checks have')} no result. An unknown check has no eligible PASS or FAIL result. While a required check is unknown, the change cannot be READY.`, '',
    ...table(['Check', 'Effect', 'Why it is unknown', 'How to resolve it'], rows), ...(unknown.length > listLimit ? ['', ...rest(listLimit, unknown.length, 'unknown checks')] : [])];
}

function limitLines(results) {
  const limits = results.limits ?? [], gaps = results.gaps ?? [], profile = code(results.profileId);
  return ['This report has these limits:', '',
    '- Code-map used static evidence only. This evidence is the stored analyses of the source code and the test reports in the request.',
    '- Code-map ran no project code, no test and no build for this report.',
    '- A test report counts only when its run manifest ties it to the analyzed code. The project\'s own run writes that manifest. Thus the manifest shows which code the report describes, but not that the run was honest.', '',
    ...(limits.length ? [`The rule set ${profile} cannot assess these items yet:`, '', ...bullets(limits.slice(0, itemLimit).map((limit) => plain(limit)), limits.length, 'limits')]
      : [`The rule set ${profile} lists no other limits.`]), '',
    ...(gaps.length ? ['The head analysis has these evidence gaps:', '', ...bullets(gaps.slice(0, itemLimit).map((gap) => `${plain(gap.text)}${Number.isInteger(gap.count) ? ` Count: ${gap.count}.` : ''}`), gaps.length, 'evidence gaps')]
      : ['The head analysis reports no evidence gap.'])];
}

function fullResults(results) {
  const hypotheses = results.llmHypotheses?.length ?? 0;
  return [`The file [${fileNames.results}](./${fileNames.results}) in this folder has every check with its evidence, and the predicates of each rating. `
    + (hypotheses ? `It also has ${plural(hypotheses, 'hypothesis', 'hypotheses')} from a language model. They are not verified, and they change no check, rating or readiness.`
      : 'No language model added a hypothesis to this report.')];
}

const runIdPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const digest = (text) => createHash('sha256').update(text, 'utf8').digest('hex');
const entryOf = (path) => { try { return lstatSync(path); } catch (error) { if (error?.code === 'ENOENT') return null; throw error; } };

/**
 * Publishes one run under `root`: runs/<runId>/ with both files, then latest.json, which names the run, its readiness, its exit code and the
 * two files with their SHA-256 digests. The paths in latest.json are relative to `root`. Folders are 0700 and files 0600. Code-map never
 * replaces an earlier run. If a step fails, the new folder goes and latest.json stays as it was. `repository`, when given, is the mapped
 * repository: no folder that the run writes into can be in it.
 */
export function writeRun(root, { runId, results, markdown, repository }) {
  if (typeof runId !== 'string' || !runIdPattern.test(runId)) throw new Error(`"${runId}" is not a valid run ID. A run ID has 1 to 128 letters, digits, ".", "_" or "-", and it starts with a letter or a digit.`);
  if (!isRecord(results)) throw new TypeError('The verification results must be an object.');
  if (results.runId !== undefined && results.runId !== runId) throw new Error(`The results belong to run ${results.runId}, not to run ${runId}.`);
  if (typeof markdown !== 'string') throw new TypeError('The Markdown report must be a string.');
  const json = `${JSON.stringify(results, null, 2)}\n`;
  const runs = join(root, 'runs'), dir = join(runs, runId), manifestPath = join(root, fileNames.manifest);
  if (repository !== undefined) requireOutside(repository, [root, runs, dir]);
  if (entryOf(root)) requireSafe(root, runs);
  mkdirSync(runs, { recursive: true, mode: 0o700 });
  requireSafe(root, runs);
  let staging = null, placed = false, temporary = null;
  try {
    staging = mkdtempSync(join(runs, `.staging-${runId}-`));
    writeFileSync(join(staging, fileNames.results), json, { mode: 0o600, flag: 'wx' });
    writeFileSync(join(staging, fileNames.report), markdown, { mode: 0o600, flag: 'wx' });
    if (entryOf(dir)) throw new Error(`A verification run with the ID ${runId} already exists in ${runs}. Code-map does not replace an earlier run.`);
    renameSync(staging, dir);
    staging = null; placed = true;
    const file = (name, text) => ({ path: `runs/${runId}/${name}`, sha256: digest(text) });
    const manifest = { manifestType: 'code-map-verification-manifest', schemaVersion: 1, runId, createdAt: results.createdAt ?? null, readiness: results.readiness?.state ?? null,
      exitCode: results.readiness?.exitCode ?? null, results: file(fileNames.results, json), report: file(fileNames.report, markdown) };
    temporary = `${manifestPath}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`;
    writeFileSync(temporary, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
    renameSync(temporary, manifestPath);
  } catch (error) {
    for (const path of [staging, placed ? dir : null, temporary]) if (path) rmSync(path, { recursive: true, force: true });
    throw error;
  }
  return { dir, jsonPath: join(dir, fileNames.results), markdownPath: join(dir, fileNames.report), manifestPath };
}

/** A run inside the repository changes the working tree that verify describes. The paths are compared with their symlinks resolved. */
function requireOutside(repository, folders) {
  const top = realPath(repository), inside = folders.find((folder) => isInside(top, realPath(folder)));
  if (inside) throw new Error(`The folder ${inside}, where Code-map writes the run, is the repository or a folder inside it. A run there changes the working tree that verify describes. Choose an output folder outside the repository with --out-dir <folder>.`);
}

/** Another user who can change the output folder can replace latest.json or a run. The root follows the store root rule (rootProblem), and runs/ is private. No owners on Windows. */
function requireSafe(root, runs) {
  if (typeof process.getuid !== 'function') return;
  const uid = process.getuid(), open = rootProblem(statSync(root), uid), info = entryOf(runs);
  if (open) throw new Error(`The output folder ${root} is not safe: ${open}. Choose another one with --out-dir <folder>.`);
  const problem = !info ? null : info.isSymbolicLink() ? 'it is a symlink' : !info.isDirectory() ? 'it is not a folder' : info.uid !== uid ? 'another user owns it' : (info.mode & 0o022) ? 'other users can change it' : null;
  if (problem) throw new Error(`The folder ${runs} is not a private folder that you own: ${problem}. Remove it, or choose another output folder with --out-dir <folder>.`);
}
