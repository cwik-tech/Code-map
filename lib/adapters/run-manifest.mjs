// The run manifest that must come with an imported report: which source, command, tools, configuration and
// environment produced its artifacts. A report without a valid manifest stays unverified and cannot satisfy readiness.
// Pure: this module reads no file and runs no command. The caller supplies the parsed manifest and the digests.

export const artifactKinds = ['electron-startup', 'xstate-trace', 'harness', 'junit', 'jest-json', 'vitest-json', 'lcov', 'istanbul-json', 'stryker-json', 'mutmut-text', 'tsc', 'mypy-json', 'mypy-text', 'pyright-json', 'ruff-json', 'tsc-files', 'eslint-json', 'sarif', 'sizes', 'bench', 'pytest-benchmark-json', 'npm-audit', 'osv-snapshot', 'vitest-list', 'jest-list', 'playwright-list', 'mocha-list'];
const fields = ['manifestType', 'schemaVersion', 'source', 'command', 'workingDirectory', 'tools', 'config', 'lockfile',
  'environment', 'startedAt', 'finishedAt', 'exitStatus', 'artifacts', 'discovery'];
/** A commit ID of a SHA-1 or a SHA-256 repository. */
const commit = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/, sha256 = /^[0-9a-f]{64}$/;
const iso = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;
const isRecord = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);
const nonEmpty = (value) => typeof value === 'string' && value.length > 0;

/** A repository-relative path with "/" separators: no absolute path, drive letter, backslash, NUL, "." or ".." part. */
export function isRelativePath(value, { allowRoot = false } = {}) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 4096) return false;
  if (allowRoot && value === '.') return true;
  if (value.includes('\0') || value.includes('\\') || value.startsWith('/') || /^[A-Za-z]:/.test(value)) return false;
  return value.split('/').every((part) => part.length > 0 && part !== '.' && part !== '..');
}

/** Validates an untrusted manifest. Returns every error with its path; an unknown field is an error too. */
export function validateManifest(value) {
  const errors = [], error = (path, message) => errors.push({ path, message });
  if (!isRecord(value)) return { ok: false, errors: [{ path: '', message: 'The manifest must be a JSON object.' }] };
  for (const key of Object.keys(value)) if (!fields.includes(key) && key !== 'signature') error(key, 'This field is not part of the run manifest.');
  for (const key of fields) if (!Object.hasOwn(value, key)) error(key, 'This field is required.');
  const has = (key) => Object.hasOwn(value, key);
  if (has('signature')) checkRecord(value.signature, 'signature', ['algorithm', 'fingerprint', 'value'], error, (signature) => {
    if (signature.algorithm !== 'Ed25519') error('signature.algorithm', 'Must be Ed25519.');
    if (typeof signature.fingerprint !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(signature.fingerprint)) error('signature.fingerprint', 'Must be a SHA-256 public key fingerprint.');
    if (typeof signature.value !== 'string' || !/^[A-Za-z0-9+/]{86}==$/.test(signature.value)) error('signature.value', 'Must be a base64 Ed25519 signature.');
  });
  if (has('manifestType') && value.manifestType !== 'code-map-run-manifest') error('manifestType', 'Must be "code-map-run-manifest".');
  if (has('schemaVersion') && value.schemaVersion !== 1) error('schemaVersion', 'Must be the integer 1.');
  if (has('source')) checkRecord(value.source, 'source', ['sha', 'worktreeDigest'], error, (source) => {
    if (typeof source.sha !== 'string' || !commit.test(source.sha)) error('source.sha', 'Must be a full lowercase commit SHA: 40 characters, or 64 in a SHA-256 repository.');
    if (source.worktreeDigest !== null && (typeof source.worktreeDigest !== 'string' || !sha256.test(source.worktreeDigest))) {
      error('source.worktreeDigest', 'Must be a 64-character lowercase SHA-256 digest, or null for a commit.');
    }
  });
  if (has('command') && (!Array.isArray(value.command) || value.command.length === 0 || !value.command.every((part) => typeof part === 'string'))) {
    error('command', 'Must be a non-empty array of strings.');
  }
  if (has('workingDirectory') && !isRelativePath(value.workingDirectory, { allowRoot: true })) error('workingDirectory', 'Must be "." or a repository-relative path inside the repository.');
  if (has('tools')) checkList(value.tools, 'tools', error, (tool, path) => checkRecord(tool, path, ['name', 'version'], error, () => {
    if (!nonEmpty(tool.name)) error(`${path}.name`, 'Must be a non-empty string.');
    if (!nonEmpty(tool.version)) error(`${path}.version`, 'Must be a non-empty string.');
  }));
  if (has('config') && (typeof value.config !== 'string' || !sha256.test(value.config))) error('config', 'Must be a 64-character lowercase SHA-256 digest.');
  if (has('lockfile') && value.lockfile !== null) checkRecord(value.lockfile, 'lockfile', ['path', 'digest'], error, (lockfile) => {
    if (!isRelativePath(lockfile.path)) error('lockfile.path', 'Must be a repository-relative path.');
    if (typeof lockfile.digest !== 'string' || !sha256.test(lockfile.digest)) error('lockfile.digest', 'Must be a 64-character lowercase SHA-256 digest.');
  });
  // An isolated run of code-map run also names its backend. The field is optional, so a manifest of code-map manifest stays valid.
  if (has('environment')) checkRecord(value.environment, 'environment', ['policy', 'node', 'platform'], error, (environment) => {
    if (!nonEmpty(environment.policy)) error('environment.policy', 'Must be a non-empty string.');
    for (const key of ['node', 'platform']) if (environment[key] !== null && !nonEmpty(environment[key])) error(`environment.${key}`, 'Must be a non-empty string or null.');
    if (Object.hasOwn(environment, 'backend') && !nonEmpty(environment.backend)) error('environment.backend', 'Must be a non-empty string.');
    for (const key of ['os', 'osVersion', 'architecture', 'typescript']) {
      if (Object.hasOwn(environment, key) && !nonEmpty(environment[key])) error(`environment.${key}`, 'Must be a non-empty string.');
    }
  }, ['backend', 'os', 'osVersion', 'architecture', 'typescript']);
  const started = has('startedAt') ? time(value.startedAt, 'startedAt', error) : null, finished = has('finishedAt') ? time(value.finishedAt, 'finishedAt', error) : null;
  if (started !== null && finished !== null && finished < started) error('finishedAt', 'Must not be earlier than startedAt.');
  if (has('exitStatus') && value.exitStatus !== null && !Number.isInteger(value.exitStatus)) error('exitStatus', 'Must be an integer or null.');
  if (has('artifacts')) {
    const seen = new Set();
    checkList(value.artifacts, 'artifacts', error, (artifact, path) => checkRecord(artifact, path, ['path', 'digest', 'kind'], error, () => {
      if (!isRelativePath(artifact.path)) error(`${path}.path`, 'Must be a repository-relative file path.');
      else if (seen.has(artifact.path)) error(`${path}.path`, 'The same artifact path appears twice.');
      else seen.add(artifact.path);
      if (typeof artifact.digest !== 'string' || !sha256.test(artifact.digest)) error(`${path}.digest`, 'Must be a 64-character lowercase SHA-256 digest.');
      if (!artifactKinds.includes(artifact.kind)) error(`${path}.kind`, `Must be one of: ${artifactKinds.join(', ')}.`);
    }));
  }
  if (has('discovery') && value.discovery !== null) checkRecord(value.discovery, 'discovery', ['scope', 'filters'], error, (discovery) => {
    if (!nonEmpty(discovery.scope)) error('discovery.scope', 'Must be a non-empty string.');
    checkList(discovery.filters, 'discovery.filters', error, (filter, path) => { if (typeof filter !== 'string') error(path, 'Must be a string.'); });
    if (Object.hasOwn(discovery, 'selection')) checkRecord(discovery.selection, 'discovery.selection', ['policy', 'state', 'reason', 'sources', 'files', 'total'], error, (selection) => {
      if (selection.policy !== 'impact-v1') error('discovery.selection.policy', 'Must be impact-v1.');
      if (!['KNOWN', 'UNKNOWN'].includes(selection.state)) error('discovery.selection.state', 'Must be KNOWN or UNKNOWN.');
      if (!nonEmpty(selection.reason)) error('discovery.selection.reason', 'Must be a non-empty string.');
      for (const key of ['sources', 'files']) checkList(selection[key], `discovery.selection.${key}`, error, (file, path) => {
        if (!isRelativePath(file) || file.startsWith('-') || file.split('/').some((part) => ['.git', 'node_modules'].includes(part.toLowerCase()))) error(path, 'Must be a safe relative path.');
      });
      if (!Number.isSafeInteger(selection.total) || selection.total < 1 || selection.total !== selection.files?.length) error('discovery.selection.total', 'Must match the non-empty selected file count.');
    });
  }, ['selection']);
  return errors.length ? { ok: false, errors } : { ok: true, manifest: structuredClone(value) };
}

/** `optional`: keys that the record can have. Each key of `keys` is required. */
function checkRecord(value, path, keys, error, check, optional = []) {
  if (!isRecord(value)) { error(path, 'Must be an object.'); return; }
  for (const key of Object.keys(value)) if (!keys.includes(key) && !optional.includes(key)) error(`${path}.${key}`, 'This field is not part of the run manifest.');
  for (const key of keys) if (!Object.hasOwn(value, key)) error(`${path}.${key}`, 'This field is required.');
  check(value);
}

function checkList(value, path, error, check) {
  if (!Array.isArray(value)) { error(path, 'Must be an array.'); return; }
  value.forEach((entry, index) => check(entry, `${path}[${index}]`));
}

function time(value, path, error) {
  const parsed = typeof value === 'string' && iso.test(value) ? Date.parse(value) : Number.NaN;
  if (Number.isNaN(parsed)) { error(path, 'Must be an ISO 8601 date and time with a time zone.'); return null; }
  return parsed;
}

/**
 * Whether a report is bound to the analysis inputs (the analysis input manifest).
 * BOUND: commit, worktree digest, configuration digest, lockfile digest and the report's digest all match. The worktree digest
 * is the content digest of the analysis inputs: it covers every changed file, also snapshots and fixtures that the analysis does not read.
 * STALE: the manifest is valid, but at least one of them differs. UNBOUND: no valid manifest.
 */
export function bindingStatus(manifest, inputs, { artifactDigest } = {}) {
  if (manifest === null || manifest === undefined) {
    return { state: 'UNBOUND', reasons: [{ key: 'manifest', message: 'The report has no run manifest. It stays unverified and cannot satisfy readiness.' }] };
  }
  const checked = validateManifest(manifest);
  if (!checked.ok) {
    const first = checked.errors.slice(0, 3).map((error) => `${error.path || 'manifest'}: ${error.message}`).join(' '), more = checked.errors.length > 3 ? ` ${checked.errors.length - 3} more errors.` : '';
    return { state: 'UNBOUND', reasons: [{ key: 'manifest', message: `The run manifest is invalid, so the report cannot satisfy readiness. ${first}${more}`, errors: checked.errors.slice(0, 20) }] };
  }
  if (!isRecord(inputs)) throw new TypeError('bindingStatus needs the analysis input manifest.');
  if (typeof artifactDigest !== 'string' || !sha256.test(artifactDigest)) throw new TypeError('bindingStatus needs the SHA-256 digest of the imported report.');
  const run = checked.manifest, reasons = [];
  const differ = (key, expected, actual, message) => { if (expected !== actual) reasons.push({ key, message }); };
  differ('sha', inputs.sha, run.source.sha, `The report ran on commit ${run.source.sha.slice(0, 10)}, but the analysis is of ${String(inputs.sha).slice(0, 10)}.`);
  differ('worktree', inputs.worktree ? inputs.worktree.contentDigest : null, run.source.worktreeDigest,
    run.source.worktreeDigest === null ? 'The report ran on a clean commit, but the analysis has uncommitted changes.'
      : inputs.worktree ? 'The working tree changed after the report ran.' : 'The report ran on uncommitted changes, but the analysis is of a commit.');
  differ('config', inputs.config, run.config, 'The Code-map configuration changed after the report ran.');
  differ('lockfile', inputs.lockfile?.digest ?? null, run.lockfile?.digest ?? null, 'The dependency lockfile differs from the one recorded when the report ran.');
  if (!run.artifacts.some((artifact) => artifact.digest === artifactDigest)) reasons.push({ key: 'artifact', message: 'The manifest does not list this report, so the report can be a different file.' });
  return { state: reasons.length ? 'STALE' : 'BOUND', reasons };
}
