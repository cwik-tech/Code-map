// Generated tests require current human oracle records. This information is outside every rule set.
import { bindOracles, readOracles } from './oracles.mjs';
import { oracleTestBytes } from './oracle-files.mjs';

/** Links each generated declaration to exact scanned cases and digest-bound records for current request criteria. */
export function generatedOracles(repository, request, head) {
  if (!request.generatedTests?.length) return [];
  let records;
  try {
    const entries = readOracles(repository)?.entries ?? [];
    records = bindOracles(entries, oracleTestBytes(head, entries.map((x) => x.file)));
  } catch (error) {
    return request.generatedTests.map((item) => ({ ...item, state: 'INVALID', independent: false, cases: [], reason: error.message }));
  }
  const criteria = new Set(request.acceptanceCriteria.map((x) => x.id));
  return request.generatedTests.map((item) => {
    const selected = (head.data.analysis.tests?.cases ?? []).filter((x) => x.path === item.file && (item.name === undefined || x.name === item.name));
    const cases = selected.map((entry) => {
      const suite = entry.suite || null;
      const matching = records.filter((x) => x.file === entry.path && x.name === entry.name && x.suite === suite && criteria.has(x.criterion));
      const ambiguous = selected.filter((x) => x.name === entry.name && (x.suite || null) === suite).length !== 1;
      const state = ambiguous ? 'AMBIGUOUS' : matching.some((x) => !x.stale) ? 'CURRENT' : matching.length ? 'STALE' : 'MISSING';
      return { name: entry.name, suite, state, records: matching };
    });
    const independent = cases.length > 0 && cases.every((x) => x.state === 'CURRENT');
    return { ...item, independent, state: independent ? 'CURRENT' : 'UNCONFIRMED', cases,
      reason: 'Independence requires a current human oracle for every selected case. Identity and oracle truth are not authenticated.' };
  });
}
