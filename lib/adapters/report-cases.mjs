// Normalize test report cases without filesystem or worker dependencies.
import { isAbsolute, posix, relative, sep } from 'node:path';
import { parseJUnit } from './junit.mjs';
import { parseTestResults } from './test-results-json.mjs';

const maxReportBytes = 50 * 1024 * 1024;
/** The duration of a case in milliseconds, from the seconds of the adapters (JUnit time, Jest and Vitest duration), or null. */
const milliseconds = (seconds) => (typeof seconds === 'number' && Number.isFinite(seconds) ? Math.round(seconds * 1e6) / 1e3 : null);

/** The repository-relative path of a test file name in a report: an absolute name inside the repository, or a name relative to the working directory of the run. */
function placeOf(name, workingDirectory, repository) {
  if (typeof name !== 'string' || name.length === 0 || name.includes('\0')) return null;
  const path = posix.normalize(isAbsolute(name) ? relative(repository, name).split(sep).join('/') : posix.join(workingDirectory, name.replaceAll('\\', '/')));
  return path === '.' || path === '..' || path.startsWith('../') || posix.isAbsolute(path) ? null : path;
}

/** The test cases of a report in the shape of the rule set: { file, suite, classname, name, status, duration }. */
export function reportCases(text, kind, repository, run, testFiles) {
  if (kind === 'junit') {
    const parsed = parseJUnit(text, { maxBytes: maxReportBytes });
    if (!parsed.ok) return { error: parsed.error };
    // A JUnit case names its file in the file attribute. Some producers name it only in the class name, which counts when it is a known test file.
    const pythonFile = (classname) => {
      if (typeof classname !== 'string') return null;
      const matches = [...testFiles].filter((path) => path.endsWith('.py')).filter((path) => {
        const name = path.slice(0, -3).replaceAll('/', '.');
        const relativeName = posix.relative(run.workingDirectory, path).slice(0, -3).replaceAll('/', '.');
        return [name, relativeName].some((n) => classname === n || classname.startsWith(n + '.'));
      });
      return matches.length === 1 ? matches[0] : null;
    };
    const fileOf = (item) => placeOf(item.file, run.workingDirectory, repository) ?? [placeOf(item.classname, run.workingDirectory, repository)].find((path) => testFiles.has(path)) ?? pythonFile(item.classname);
    return { mismatches: parsed.report.mismatches, fileFailures: [], cases: parsed.report.cases.map((item) => {
      const file = fileOf(item), suite = file !== null && placeOf(item.suite, run.workingDirectory, repository) === file ? file : item.suite ?? null;
      return { file, suite, classname: item.classname ?? null, name: item.name, status: item.status, duration: milliseconds(item.time) };
    }) };
  }
  const parsed = parseTestResults(text, { repository, format: kind, maxBytes: maxReportBytes });
  if (!parsed.ok) return { error: parsed.errors.slice(0, 3).map((error) => `${error.path || 'report'}: ${error.message}`).join(' ') };
  const failedFiles = new Set(parsed.report.cases.filter((item) => item.status === 'failed' || item.status === 'errored').map((item) => item.file));
  return { mismatches: parsed.report.mismatches, fileFailures: parsed.report.files.filter((file) => file.status === 'failed' && (file.cases === 0 || !failedFiles.has(file.file))),
    cases: parsed.report.cases.map((item) => ({ file: item.file, suite: item.suite ?? null, name: item.name, status: item.status, duration: milliseconds(item.time) })) };
}
