// Isolated packaging readers. Requirements includes stay inside the supplied snapshot.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, posix } from 'node:path';
import { fileURLToPath } from 'node:url';

const declarationFolder = (path) => posix.basename(posix.dirname(path)) === 'requirements' ? posix.dirname(posix.dirname(path)) : posix.dirname(path);
export const normalizeDistribution = (name) => name.toLowerCase().replace(/[-_.]+/g, '-');
export const declarationPath = (path) => /(?:^|\/)(?:pyproject\.toml|setup\.(?:cfg|py)|Pipfile(?:\.lock)?|uv\.lock|poetry\.lock|requirements[^/]*\.txt)$|(?:^|\/)requirements\/[^/]+\.txt$/.test(path);
export const configPath = (path) => !/(?:^|\/)\.env(?:[./]|$)/.test(path) && (/^(?:\.github\/workflows\/[^/]+\.ya?ml)$/.test(path)
  || /(?:^|\/)(?:Makefile|Dockerfile[^/]*|Procfile|docker-compose[^/]*\.ya?ml|tox\.ini|(?:noxfile|conftest|settings|manage|wsgi|asgi|fabfile)\.py|[^/]+\.(?:sh|bash|cfg|ini|toml|ya?ml)|package\.json)$/.test(path));
const requirement = (text) => /^([A-Za-z0-9][A-Za-z0-9._-]*)(?:\[[^\]]*\])?\s*(?:[<>=!~;@]|$)/.exec(text)?.[1];
const validResult = (v) => v && typeof v.path === 'string' && typeof v.declares === 'boolean'
  && Array.isArray(v.dependencies) && v.dependencies.every((d) => d && typeof d.value === 'string' && ['main', 'optional', 'development'].includes(d.group))
  && Array.isArray(v.entries) && v.entries.every((e) => e && typeof e.target === 'string' && typeof e.group === 'string')
  && Array.isArray(v.references) && v.references.every((s) => typeof s === 'string')
  && Array.isArray(v.unknown) && v.unknown.every((s) => typeof s === 'string') && Array.isArray(v.locked) && v.locked.every((s) => typeof s === 'string');

export function readPythonDeclarations(texts, interpreter) {
  const result = { declarations: [], entries: [], manifests: [], scopes: [], unknown: [], skipped: [], locked: [], references: [] };
  const add = (path, value, group, owner = path) => {
    const name = requirement(value);
    if (!name) { result.skipped.push({ path, reason: 'unsupported-requirement' }); result.unknown.push({ path, owner, reason: 'unsupported-dependency-requirement' }); return; }
    result.declarations.push({ name: normalizeDistribution(name), path, group, folder: declarationFolder(owner) });
  };
  const manifest = (path, owner = path) => {
    if (!result.manifests.includes(path)) result.manifests.push(path);
    const folder = declarationFolder(owner);
    if (!result.scopes.some((s) => s.path === path && s.folder === folder)) result.scopes.push({ path, folder });
  };
  const includePaths = new Set(), visited = new Set();
  const readRequirements = (path, stack = [], constraint = false, group = 'main', owner = path) => {
    if (stack.includes(path) || stack.length >= 16) { result.unknown.push({ path, owner, reason: stack.includes(path) ? 'requirements-include-cycle' : 'requirements-include-depth-limit' }); return; }
    const key = `${path}:${constraint}:${group}:${owner}`;
    if (visited.has(key)) return;
    visited.add(key);
    if (visited.size > 1024) { result.unknown.push({ path, owner, reason: 'requirements-include-count-limit' }); return; }
    const text = texts.get(path);
    if (text === undefined) { result.unknown.push({ path, owner, reason: 'requirements-include-unavailable' }); return; }
    if (!constraint) manifest(path, owner);
    const ownGroup = /(?:^|[_.-])(?:dev|development|tests?|lint|docs)(?:[_.-]|$)/i.test(posix.basename(path)) ? 'development' : group;
    for (const [lineIndex, raw] of text.replace(/\\\r?\n/g, '').split(/\r?\n/).entries()) {
      const line = raw.replace(/\s+#.*$/, '').trim();
      if (!line || line.startsWith('#')) continue;
      const include = /^(?:-([rc])\s*|--(requirement|constraint)(?:\s+|=))(.+)$/.exec(line);
      if (include) {
        const target = posix.normalize(posix.join(posix.dirname(path), include[3].trim().replace(/^['"]|['"]$/g, '')));
        if (target.startsWith('../') || posix.isAbsolute(target) || target.includes('://')) result.unknown.push({ path, owner, reason: 'requirements-include-outside-or-unsupported' });
        else { includePaths.add(target); readRequirements(target, [...stack, path], constraint || include[1] === 'c' || include[2] === 'constraint', ownGroup, owner); }
      } else if (/^(?:-|\.|\/|[\w+.-]+:\/\/)/.test(line) || /\s@\s/.test(line)) result.skipped.push({ path, line: lineIndex + 1, reason: line === '-e .' ? 'editable-project' : 'option-url-or-path' });
      else if (!constraint) add(path, line, ownGroup, owner);
    }
  };
  const reqs = [...texts.keys()].filter((p) => /(?:^|\/)requirements[^/]*\.txt$|(?:^|\/)requirements\/[^/]+\.txt$/.test(p));
  const referenced = new Set();
  for (const path of reqs) for (const match of texts.get(path).matchAll(/^\s*(?:-[rc]\s*|--(?:requirement|constraint)(?:\s+|=))([^\r\n#]+)/gm)) {
    referenced.add(posix.normalize(posix.join(posix.dirname(path), match[1].trim().replace(/^['"]|['"]$/g, ''))));
  }
  for (const path of reqs.filter((p) => !referenced.has(p))) readRequirements(path);
  // A closed include cycle has no graph root. Read it once so its literals remain visible.
  for (const path of reqs) if (!includePaths.has(path) && ![...visited].some((key) => key.startsWith(path + ':'))) readRequirements(path);
  const configs = [...texts].filter(([p]) => declarationPath(p) && !p.endsWith('.txt')).map(([path, text]) => ({ path, text }));
  if (!interpreter) {
    if (configs.length) result.unknown.push({ path: null, reason: 'packaging-interpreter-unavailable' });
    return result;
  }
  const cwd = mkdtempSync(join(tmpdir(), 'code-map-packaging-'));
  try {
    // One bounded file per child prevents a large metadata file from hiding other declarations.
    for (const config of configs) {
      if (Buffer.byteLength(config.text) > 1024 * 1024) { result.unknown.push({ path: config.path, reason: 'packaging-text-limit' }); continue; }
      const child = spawnSync(interpreter.path, ['-I', '-S', '-B', '-W', 'ignore', fileURLToPath(new URL('./metadata.py', import.meta.url))],
        { cwd, input: JSON.stringify([config]), encoding: 'utf8', shell: false, timeout: 15000, maxBuffer: 4 * 1024 * 1024 });
      let output;
      try { output = JSON.parse(child.stdout); } catch { output = null; }
      if (child.error || child.status !== 0 || !Array.isArray(output) || output.length !== 1 || !validResult(output[0]) || output[0].path !== config.path) {
        result.unknown.push({ path: config.path, reason: 'packaging-parser-failed' }); continue;
      }
      const item = output[0];
      if (item.declares) manifest(item.path);
      for (const d of item.dependencies) add(item.path, d.value, d.group);
      result.references.push(...item.references.map((text) => ({ path: item.path, text })));
      result.entries.push(...item.entries.map((e) => ({ ...e, path: item.path })));
      result.unknown.push(...item.unknown.map((reason) => ({ path: item.path, reason })));
      result.locked.push(...item.locked.map(normalizeDistribution));
    }
  } finally { rmSync(cwd, { recursive: true, force: true }); }
  result.declarations = result.declarations.filter((d, i, all) => all.findIndex((v) => v.name === d.name && v.path === d.path && v.group === d.group && v.folder === d.folder) === i);
  return result;
}
