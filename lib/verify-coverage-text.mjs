// Coverage text of the verification report. Pure: no file or command.
import { code, plural, series, table } from './verify-markdown.mjs';

const isRecord = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);
const count = (value) => Array.isArray(value) ? value.length : Number.isInteger(value) ? value : null;

/**
 * The coverage of the changed code from the bound coverage reports of the head (results.coverage), with the thresholds of the rule set.
 * The statement and function rows appear only when a report gives them. Results without `lineReports` have only LCOV reports.
 */
export function coverageLines({ coverage }, itemLimit) {
  if (!isRecord(coverage)) return ['No bound coverage report of the head exists, so Code-map has no line coverage of the changed code. Verification Coverage needs one for a rating.'];
  const percent = (value) => typeof value === 'number' ? `${value}%` : 'None', total = count(coverage.files?.total);
  const files = (measured) => total !== null && count(measured) !== null ? plural(total - measured, 'file', 'files') : 'Unknown';
  const row = (name, part, measured = part?.files?.measured) => [name, `${count(part?.covered) ?? 0} of ${count(part?.total) ?? 0}`, percent(part?.share), percent(part?.threshold), files(measured)];
  const reports = Array.isArray(coverage.reports) ? coverage.reports.map((path) => code(path)) : [], missing = Array.isArray(coverage.files?.unmeasured) ? coverage.files.unmeasured : [];
  const lineReports = Array.isArray(coverage.lineReports) ? coverage.lineReports.length : reports.length, statements = isRecord(coverage.changedStatements), functions = isRecord(coverage.changedFunctions);
  const outside = count(coverage.outsideRepository) ?? 0, unmeasured = total !== null && count(coverage.files?.measured) !== null ? total - coverage.files.measured : missing.length;
  const listed = (paths, all) => { const named = paths.slice(0, itemLimit).map((path) => code(path)); return all > named.length ? `${named.join(', ')} and ${all - named.length} more` : series(named); };
  const list = listed(missing, unmeasured);
  const gap = (name, part) => {
    const paths = Array.isArray(part?.files?.unmeasured) ? part.files.unmeasured : [], all = total !== null && count(part?.files?.measured) !== null ? total - part.files.measured : paths.length;
    return isRecord(part) && all > 0 && paths.length ? `${name} does not measure ${plural(all, 'changed code file', 'changed code files')}: ${listed(paths, all)}.` : '';
  };
  const gaps = [gap('Statement coverage', coverage.changedStatements), gap('Function coverage', coverage.changedFunctions), gap('Branch coverage', coverage.changedBranches)].filter(Boolean).join(' ');
  const fromIstanbul = count(coverage.changedBranches?.sources?.['istanbul-json']) ?? 0, join = coverage.changedFunctions?.join ?? {}, changed = count(coverage.changedFunctions?.total) ?? 0;
  return [`Code-map maps the lines that the change adds or modifies in each changed code file to the records of ${series(reports, 5) || 'the coverage reports'}. `
    + 'A line with a DA record of an LCOV report is executable, and it is covered when its count is more than 0. A DA record counts a line, so the measure is line coverage. '
    + 'An LCOV branch is a BRDA record on a changed line.'
    + (statements ? ' A statement, a function or a branch of an Istanbul JSON report counts when its source range touches a changed line.' : functions ? ' A function counts when its range touches a changed line.' : '')
    + (statements || functions ? ' Statement and function coverage are information only, and no rating condition uses them.' : ''), '',
  ...table(['Measure', 'Covered', 'Share', 'Threshold', 'Not measured'], [row('Changed executable lines (line coverage)', coverage.changedLines, coverage.files?.measured),
    row('Changed branches', coverage.changedBranches, coverage.changedBranches?.files?.measured ?? coverage.files?.measured),
    ...(statements ? [row('Changed statements (statement coverage)', coverage.changedStatements)] : []), ...(functions ? [row('Changed functions (function coverage)', coverage.changedFunctions)] : [])]), '',
  !lineReports ? 'No bound LCOV report of the head exists, so Code-map has no line coverage of the changed code. Verification Coverage needs one for a rating.'
    : unmeasured > 0 ? `${plural(unmeasured, 'changed code file has', 'changed code files have')} no SF record in the LCOV reports: ${list}. `
    + `Code-map counts ${unmeasured === 1 ? 'it' : 'them'} as not measured, never as covered, so the coverage conditions are not met.` : 'The LCOV reports measure each changed code file that has changed lines.',
  ...(gaps ? ['', gaps] : []),
  ...(fromIstanbul > 0 && lineReports ? ['', `Code-map takes the branches and functions of ${plural(fromIstanbul, 'changed code file', 'changed code files')} from Istanbul JSON, also where an LCOV report measures the file. It never adds the two kinds together.`] : []),
  ...(functions ? ['', `Code-map joined ${count(join.exact) ?? 0} of ${plural(changed, 'changed function', 'changed functions')} to one function of the head analysis by file and start line. `
    + `${count(join.ambiguous) ?? 0} had more than one possible match, and ${count(join.missing) ?? 0} had no match.`] : []),
  ...(outside > 0 ? ['', `${plural(outside, 'record', 'records')} of the coverage reports ${outside === 1 ? 'is' : 'are'} outside the repository. Code-map ignored ${outside === 1 ? 'it' : 'them'}.`] : [])];
}

/** Informational project views, executed export gaps and adjusted base coverage loss. */
export function coverageEvidenceLines({ coverageEvidence: evidence }, itemLimit) {
  if (!evidence) return [];
  const totals = evidence.project.totals, lost = evidence.lost;
  return ['', '### Additional measured coverage', '',
    'These observations are information only. They do not change rating conditions.', '',
    ...table(['Project measure', 'Covered', 'Total'], Object.entries(totals).filter(([, part]) => part).map(([kind, part]) => [kind, part.covered, part.total])), '',
    ...table(['File', 'Lines', 'Statements', 'Branches', 'Functions'], evidence.project.files.details.slice(0, itemLimit).map((file) => [code(file.path),
      ...['lines', 'statements', 'branches', 'functions'].map((kind) => file[kind] ? `${file[kind].covered} of ${file[kind].total}` : 'Not measured')])), '',
    `${lost.label}: ${lost.totals.lines} lines and ${lost.totals.branches} branches. ${lost.comparable ? 'Both revisions have bound reports.' : 'A bound report is missing for one revision.'}`, '',
    `Unexecuted exports (${evidence.unexecutedExports.evidence}): ${evidence.unexecutedExports.total}.`,
    ...evidence.unexecutedExports.details.slice(0, itemLimit).map((fn) => `- ${code(fn.path)}:${fn.line} ${code(fn.name)}`),
    ...evidence.mapping.filter((item) => item.entries).slice(0, itemLimit).map((item) => `Source maps in ${code(item.artifact)}: ${item.entries} entries, ${item.unmapped} unmapped measurements, ${item.errors.length} unsupported maps.`)];
}
