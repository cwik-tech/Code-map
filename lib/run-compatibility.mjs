// Exact environment policy for pairwise test evidence. Missing historical facts stay unknown.
export const environmentPolicy = 'exact-environment-v1';
const fields = ['policy', 'node', 'platform', 'os', 'osVersion', 'architecture', 'typescript'];
/** Recorded required fields must exist and agree. Optional backend values must also agree. */
export function compareEnvironments(head, base) {
  const missingFields = fields.filter((key) => typeof head?.[key] !== 'string' || !head[key] || typeof base?.[key] !== 'string' || !base[key]);
  const differences = [...fields, 'backend'].filter((key) => !missingFields.includes(key) && head?.[key] !== base?.[key]);
  const state = missingFields.length ? 'UNKNOWN' : differences.length ? 'INCOMPARABLE' : 'COMPARABLE';
  return { policy: environmentPolicy, state, eligible: state === 'COMPARABLE', missingFields, differences };
}
/** Command, directory, tools and every required environment value identify comparable attempts. */
export function testRunIdentity(report) {
  if (!report.run || !compareEnvironments(report.run.environment, report.run.environment).eligible) return null;
  const { command, workingDirectory, tools, environment } = report.run;
  return JSON.stringify([report.kind, command, workingDirectory, tools.map(({ name, version }) => [name, version]).sort(),
    [...fields, 'backend'].map((key) => environment[key] ?? null)]);
}
