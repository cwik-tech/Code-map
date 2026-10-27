// Finds and caches a Python 3.8+ interpreter outside the scanned repository.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync, realpathSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, isAbsolute, join, relative, sep } from 'node:path';

const choices = new Map();
const entries = (path) => { try { return readdirSync(path); } catch { return []; } };
const commandName = (value) => typeof value === 'string' && /^python3(?:\.\d+)?$/.test(value);
const unknown = (reason) => ({ state: 'UNKNOWN', interpreter: null, reason });
const inside = (root, path) => {
  const child = relative(root, path);
  return child === '' || (!isAbsolute(child) && child !== '..' && !child.startsWith(`..${sep}`));
};
function candidateState(candidate) {
  try {
    const path = realpathSync(candidate), info = statSync(path, { bigint: true });
    return { candidate, path, stamp: [info.dev, info.ino, info.mode, info.size, info.mtimeNs, info.ctimeNs].map(String) };
  } catch { return { candidate, path: null }; }
}

export function findInterpreter(setting, repository = process.cwd()) {
  const environment = process.env.CODE_MAP_PYTHON;
  const source = environment !== undefined ? 'environment' : setting !== undefined ? 'setting' : 'discovery';
  if (source === 'environment' && !isAbsolute(environment)) return unknown('CODE_MAP_PYTHON must name an absolute interpreter path.');
  if (source === 'setting' && !commandName(setting)) return unknown(`Refused python.interpreter ${JSON.stringify(setting)}. Use python3 or python3.<minor>, without a path.`);
  const root = realpathSync(repository);
  const folders = [...new Set([...(process.env.PATH ?? '').split(delimiter).filter(isAbsolute), '/opt/homebrew/bin', '/usr/local/bin', '/usr/bin',
    ...entries('/Library/Frameworks/Python.framework/Versions').map((v) => `/Library/Frameworks/Python.framework/Versions/${v}/bin`)])];
  const candidates = (source === 'environment' ? [environment] : source === 'setting' ? folders.map((folder) => join(folder, setting))
    : folders.flatMap((folder) => entries(folder).filter(commandName).map((name) => join(folder, name)))).map(candidateState);
  // Re-read canonical paths and file metadata before cache lookup to detect replaced executables and links.
  const key = JSON.stringify({ root, setting, environment, source, path: process.env.PATH, folders, candidates });
  if (choices.has(key)) return choices.get(key);
  const seen = new Set(), found = [], refused = [];
  const cwd = mkdtempSync(join(tmpdir(), 'code-map-python-probe-'));
  try {
    for (const { candidate, path } of candidates) {
      if (path === null || seen.has(path)) continue;
      seen.add(path);
      if (inside(root, path)) { refused.push(`Refused ${source} interpreter ${JSON.stringify(candidate)}: its real path is inside the scanned repository.`); continue; }
      const result = spawnSync(path, ['-I', '-S', '-B', '-W', 'ignore', '-c', 'import sys,json; print(json.dumps(list(sys.version_info[:3])))'],
        { cwd, shell: false, encoding: 'utf8', timeout: 3000, maxBuffer: 4096 });
      if (result.error || result.status !== 0) {
        const reason = result.error ? `could not complete (${result.error.code ?? result.error.message})`
          : result.signal ? `ended with signal ${result.signal}` : `exited with status ${result.status}`;
        refused.push(`Probe of ${JSON.stringify(candidate)} ${reason}.`);
        continue;
      }
      try {
        const version = JSON.parse(result.stdout);
        if (!Array.isArray(version) || version.length !== 3 || !version.every(Number.isInteger) || version[0] !== 3 || version[1] < 8) continue;
        found.push({ path, version: version.join('.'), parts: version });
      } catch { /* A non-Python executable is not an interpreter. */ }
    }
  } finally { rmSync(cwd, { recursive: true, force: true }); }
  found.sort((a, b) => b.parts[1] - a.parts[1] || b.parts[2] - a.parts[2]);
  const result = found.length ? { state: 'KNOWN', interpreter: { path: found[0].path, version: found[0].version, source } }
    : unknown(refused.join(' ') || `No usable Python interpreter (version 3.8 or later) was found for ${source}${source === 'setting' ? ` ${JSON.stringify(setting)}` : ''}.`);
  // A failed probe can be transient even when the executable metadata is unchanged. Do not cache UNKNOWN.
  if (result.state === 'KNOWN') {
    if (choices.size >= 128) choices.clear();
    choices.set(key, result);
  }
  return result;
}
