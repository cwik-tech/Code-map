// Test-run matching, failure identities and earlier-failure counts for the static baseline profile.
import { canonical } from '../inputs.mjs';

export const failed = (item) => item.status === 'failed' || item.status === 'errored';
/** A JUnit report often uses the file as the suite name, so a suite equal to the file is left out of the name. */
export const caseName = (item) => { const file = item.file ?? item.path; return [file, item.suite === file ? null : item.suite, item.name].filter(Boolean).join(' > '); };

/** Run identity: a base report counts for a head report only when both come from the same command, tools and environment. */
const runOf = (report) => report.comparisonEligible === false || report.run === undefined || report.run === null ? null : canonical([report.kind, report.run]);

export function runFailures(f) {
  const heads = f.heads, keyOf = (entry, rename = (path) => path) => JSON.stringify([entry.file === null ? null : rename(entry.file),
    entry.file !== null && entry.suite === entry.file ? rename(entry.suite) : entry.suite ?? null, entry.file === null ? entry.classname ?? null : null, entry.name]);
  return heads.flatMap((report) => {
    const run = runOf(report), bases = run === null ? [] : f.bases.filter((other) => runOf(other) === run);
    const old = new Map();
    // Repeated base attempts do not increase the number of earlier failures of one identity.
    for (const other of bases) {
      const counts = new Map();
      for (const entry of other.cases.filter(failed)) {
        const key = keyOf(entry, f.rename);
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
      for (const [key, count] of counts) old.set(key, Math.max(old.get(key) ?? 0, count));
    }
    return report.cases.filter(failed).map((entry) => {
      const key = keyOf(entry), count = old.get(key) ?? 0;
      if (count > 0) old.set(key, count - 1);
      return { artifact: report.artifact, name: caseName(entry), compared: bases.length > 0, old: count > 0 };
    });
  });
}
