// Deployment variable names only. Values never leave the parser.
import { posix } from 'node:path';
import { envProjectFolders, isPlatformName, isPlatformRead } from './env.mjs';
const validName = /^[A-Za-z_][A-Za-z0-9_]*$/;
/** Read Docker ENV/ARG, Vercel env and Compose environment mappings. */
export function deploymentEntries(path, text) {
  const names = [], gaps = [];
  let stage = -1;
  const stages = [], aliases = new Map();
  const add = (name, line, kind = 'runtime') => {
    if (validName.test(name) && !names.some((x) => x.name === name && x.kind === kind && x.stage === stage)) names.push({ name, line, kind, stage });
  };
  if (posix.basename(path) === 'vercel.json') {
    try {
      const value = JSON.parse(text);
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid-object');
      if (value.env !== undefined && (!value.env || typeof value.env !== 'object' || Array.isArray(value.env))) throw new Error('invalid-env');
      for (const name of Object.keys(value.env ?? {})) { if (!validName.test(name)) gaps.push('invalid-name'); else add(name, null); }
    } catch { gaps.push('invalid-json-or-env'); }
  } else if (posix.basename(path) === 'Dockerfile') {
    const lines = text.split(/\r?\n/);
    for (let index = 0; index < lines.length; index++) {
      let raw = lines[index], line = index + 1;
      while (/\\\s*$/.test(raw) && index + 1 < lines.length) raw = raw.replace(/\\\s*$/, ' ') + lines[++index].trim();
      const from = /^\s*FROM\s+(?:--platform=\S+\s+)?(\S+)(?:\s+AS\s+(\S+))?\s*(?:#.*)?$/i.exec(raw);
      if (from) {
        stage++;
        const parent = aliases.get(from[1].toLowerCase());
        stages.push({ parent: parent ?? null });
        if (from[2]) aliases.set(from[2].toLowerCase(), stage);
        if (from[1].includes('$')) gaps.push('unknown-stage-parent');
        continue;
      }
      if (/^\s*FROM\b/i.test(raw)) gaps.push('unsupported-stage');
      const match = /^\s*(ENV|ARG)\s+(.+)$/i.exec(raw);
      if (!match) continue;
      const parts = match[2].match(/(?:[^\s"']|"(?:\\.|[^"\\])*"|'[^']*')+/g) ?? [];
      if (parts[0]?.includes('=')) {
        for (const part of parts) {
          const name = part.slice(0, part.indexOf('='));
          if (part.includes('=') && validName.test(name)) add(name, line, match[1].toUpperCase()); else gaps.push('unsupported-docker-declaration');
        }
      } else if (validName.test(parts[0] ?? '')) add(parts[0], line, match[1].toUpperCase());
      else gaps.push('unsupported-docker-declaration');
    }
  } else {
    let indent = null, block = null;
    text.split(/\r?\n/).forEach((raw, index) => {
      if (!raw.trim() || raw.trim().startsWith('#')) return;
      const size = raw.length - raw.trimStart().length;
      if (/^\s*environment\s*:/.test(raw)) {
        indent = size; block = null;
        if (!/^\s*environment:\s*(?:#.*)?$/.test(raw)) gaps.push('unsupported-compose-environment');
        return;
      }
      if (indent === null) return;
      if (size <= indent) { indent = null; return; }
      if (block !== null && size > block) return;
      const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.*)$/.exec(raw);
      if (match) { add(match[1], index + 1); block = /^[|>]/.test(match[2]) ? size : null; }
      else gaps.push('unsupported-compose-entry');
    });
  }
  const active = new Set([stage]);
  for (let current = stage; current >= 0 && stages[current]?.parent !== null && stages[current]?.parent !== undefined;) {
    current = stages[current].parent;
    active.add(current);
  }
  for (const entry of names) entry.runtime = entry.kind !== 'ARG' && active.has(entry.stage);
  return { state: gaps.length ? 'UNKNOWN' : 'KNOWN', names, gaps: [...new Set(gaps)] };
}
/** Compare deployment names with reads and templates within the nearest package. */
export function compareDeployment(paths, documents, env) {
  const roots = envProjectFolders(paths);
  const owner = (path) => roots.find((root) => root === '.' || path.startsWith(`${root}/`)) ?? null;
  const own = (path) => documents.filter((x) => owner(x.path) === owner(path));
  const matches = (actual, expected, sensitive = true) => sensitive === false ? actual.toLowerCase() === expected.toLowerCase() : actual === expected;
  const missing = (path, name, sensitive = true) => own(path).length > 0 && own(path).every((x) => x.state === 'KNOWN') && !own(path).some((x) => x.names?.some((y) => matches(y.name, name, sensitive) && y.runtime !== false));
  const reads = env.reads.filter((x) => x.name !== null && !isPlatformRead(x));
  return { documents,
    buildOnly: documents.flatMap((x) => (x.names ?? []).filter((y) => y.runtime === false).map((y) => ({ path: x.path, ...y }))),
    ambiguousReads: reads.filter((x) => missing(x.path, x.name, x.caseSensitive) && own(x.path).some((d) => d.names?.some((y) => matches(y.name, x.name, x.caseSensitive) && y.kind === 'ARG')))
      .map(({ path, name }) => ({ path, name, reason: 'Build-time or runtime execution of this read is unknown.' })),
    missingReads: reads.filter((x) => missing(x.path, x.name, x.caseSensitive)).map(({ path, name }) => ({ path, name })),
    missingTemplates: env.templates.filter((x) => x.state === 'read').flatMap((x) => x.names.filter((y) => !isPlatformName(y.name) && missing(x.path, y.name)).map((y) => ({ path: x.path, name: y.name }))),
    unused: documents.flatMap((x) => (x.names ?? []).filter((y) => y.runtime !== false && !isPlatformName(y.name) && !reads.some((z) => owner(z.path) === owner(x.path) && matches(z.name, y.name, z.caseSensitive)))
      .map((y) => ({ path: x.path, name: y.name }))) };
}
