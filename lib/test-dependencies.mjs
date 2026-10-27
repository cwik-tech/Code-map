// Regression dependency disclosure. Imported reports cannot attest their installed dependency tree.
const lockfiles = new Set(['package-lock.json', 'npm-shrinkwrap.json', 'pnpm-lock.yaml', 'yarn.lock', 'bun.lock', 'bun.lockb']);
/** Summarizes lockfile changes and the known dependency policy of isolated comparisons. */
export function testDependencies(reports, baseLock, headLock, supply, files = []) {
  const compared = reports.base.length > 0 && reports.head.length > 0;
  const changedLockfiles = [...new Set(files.flatMap((file) => [file.path, file.from]).filter((path) => lockfiles.has(path)))].sort();
  const lockfilesChanged = changedLockfiles.length > 0 || baseLock?.path !== headLock?.path || baseLock?.digest !== headLock?.digest;
  const isolated = compared && [...reports.base, ...reports.head].every((report) => report.attestation === 'isolated' && ['clone', 'read-only-link'].includes(report.nodeModules));
  const revisionDependenciesPrepared = compared && [...reports.base, ...reports.head].every((report) => report.attestation === 'isolated'
    && report.nodeModules === 'revision-offline' && report.dependencies?.prepared === true
    && report.dependencies.install?.status === 'prepared');
  const sides = Object.fromEntries(['base', 'head'].map((side) => [side, reports[side].map((report) => ({
    artifact: report.artifact, mode: report.nodeModules ?? 'unknown', preparation: report.dependencies ?? null }))]));
  return { compared, revisionDependenciesPrepared, sides, lockfilesChanged, changedLockfiles, base: baseLock, head: headLock,
    counts: lockfilesChanged ? supply.counts : null, examples: lockfilesChanged ? supply.changes.slice(0, 10) : [],
    supplyState: supply.state, reasons: supply.reasons, baseUsesHeadDependencies: isolated ? true : null,
    limit: 'Isolated workers can clone or link the working folder node_modules for both sides. This policy uses the head dependencies for the base. Explicit offline installs use each revision lockfile and a read-only npm cache. Missing cached packages fail preparation. The worker still denies network access.' };
}
