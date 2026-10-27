// Bounded snapshots of workspace files. Links are recorded without following them.
import { closeSync, constants, fstatSync, lstatSync, openSync, readSync, readdirSync, readlinkSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { stable } from './normalize.mjs';
const excluded = new Set(['.git', 'node_modules', '.code-map-harness']);
/** Reads at most 1 MiB through one descriptor. */
function contents(path) {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    if (!fstatSync(fd).isFile()) throw new Error('A workspace file changed type during observation');
    const data = Buffer.alloc(1048577);
    let length = 0, count;
    do { count = readSync(fd, data, length, data.length - length, null); length += count; } while (count && length < data.length);
    if (length > 1048576) throw new Error('A workspace file exceeds the 1 MiB observation limit');
    return data.subarray(0, length);
  } finally { closeSync(fd); }
}
/** Captures final file content. Throws when a bounded observation cannot be complete. */
export function workspaceFiles(root, ignoreFields = []) {
  const files = new Map();
  let entries = 0, bytes = 0;
  function walk(folder, prefix = '', depth = 0) {
    if (depth > 30) throw new Error('Workspace observation exceeds 30 levels');
    for (const name of readdirSync(folder).sort()) {
      if (excluded.has(name)) continue;
      if (++entries > 10000) throw new Error('Workspace observation exceeds 10000 entries');
      const path = join(folder, name), key = prefix + name, info = lstatSync(path);
      if (info.isSymbolicLink()) files.set(key, { type: 'link', target: readlinkSync(path) });
      else if (info.isDirectory()) walk(path, `${key}/`, depth + 1);
      else if (info.isFile()) {
        const data = contents(path); bytes += data.length;
        if (bytes > 32 * 1024 * 1024) throw new Error('Workspace observation exceeds 32 MiB');
        let normalized = data;
        if (name.endsWith('.json')) {
          let value;
          try { value = JSON.parse(data.toString('utf8')); } catch { /* Non-JSON files retain their exact bytes. */ }
          if (value !== undefined) normalized = JSON.stringify(stable(value, ignoreFields));
        }
        files.set(key, { type: 'file', digest: createHash('sha256').update(data).digest('hex'), normalizedDigest: createHash('sha256').update(normalized).digest('hex'), mode: info.mode & 0o777 });
      } else throw new Error(`Unsupported workspace entry: ${key}`);
    }
  }
  walk(root);
  return files;
}
/** Returns deterministic created, changed and removed file records. Pure. */
export function fileChanges(before, after) {
  return [...new Set([...before.keys(), ...after.keys()])].sort().flatMap((path) => {
    const a = before.get(path), b = after.get(path);
    return JSON.stringify(a) === JSON.stringify(b) ? [] : [{ path, change: !a ? 'created' : !b ? 'removed' : 'changed', before: a ?? null, after: b ?? null }];
  });
}

/** Omits durations and raw file digests only from differential comparison. Pure. */
export function comparable({ durationMs, effects, ...result }) {
  if (!effects) return result;
  const normalized = (entry) => {
    if (!entry || entry.type !== 'file') return entry;
    const { digest, ...rest } = entry;
    return rest;
  };
  const files = effects.files.map((entry) => ({ ...entry, before: normalized(entry.before), after: normalized(entry.after) }))
    .filter((entry) => JSON.stringify(entry.before) !== JSON.stringify(entry.after));
  return { ...result, effects: { ...effects, files } };
}
