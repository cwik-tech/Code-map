// Source Map v3 decoding. Positions use one-based lines and zero-based columns.
import { posix } from 'node:path';
const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const record = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const integer = (value) => Number.isSafeInteger(value) && value >= 0;

function values(segment) {
  const result = [];
  let value = 0, shift = 0;
  for (const char of segment) {
    const digit = alphabet.indexOf(char);
    if (digit < 0 || shift > 45) throw new Error('Invalid VLQ digit or overflow.');
    value += (digit % 32) * 2 ** shift;
    if (!Number.isSafeInteger(value)) throw new Error('VLQ overflow.');
    if (digit < 32) { result.push(value % 2 ? -Math.floor(value / 2) : value / 2); value = shift = 0; }
    else shift += 5;
  }
  if (shift) throw new Error('Unterminated VLQ value.');
  return result;
}

/** Decode an untrusted flat map. Unsupported maps return an explicit error. No source files are read. */
export function decodeSourceMap(map, generatedPath) {
  try {
    if (!record(map) || map.version !== 3 || map.sections !== undefined || !Array.isArray(map.sources)
      || !map.sources.every((source) => typeof source === 'string' && source.length > 0)
      || typeof map.mappings !== 'string' || (map.sourceRoot !== undefined && typeof map.sourceRoot !== 'string')
      || (map.names !== undefined && (!Array.isArray(map.names) || !map.names.every((name) => typeof name === 'string')))) throw new Error('Unsupported source map shape.');
    if (map.mappings.length > 5000000 || map.mappings.split(';').length > 1000000) throw new Error('Source map exceeds decoding limits.');
    const sources = map.sources.map((source) => {
      const root = map.sourceRoot ?? '';
      if (/^[a-z][a-z\d+.-]*:/i.test(source) || /^[a-z][a-z\d+.-]*:/i.test(root)) throw new Error('Source map URLs are unsupported.');
      const name = posix.isAbsolute(source) ? source : posix.join(root, source);
      return posix.isAbsolute(name) ? name : posix.join(posix.dirname(generatedPath), name);
    });
    let source = 0, line = 0, column = 0, name = 0, count = 0;
    const lines = map.mappings.split(';').map((text) => {
      let generated = 0;
      return text === '' ? [] : text.split(',').map((segment) => {
        if (++count > 1000000) throw new Error('Source map exceeds one million segments.');
        const fields = values(segment);
        if (![1, 4, 5].includes(fields.length) || fields[0] < 0) throw new Error('Invalid source map segment.');
        generated += fields[0];
        if (!integer(generated)) throw new Error('Invalid generated column.');
        if (fields.length === 1) return { generated, original: null };
        source += fields[1]; line += fields[2]; column += fields[3];
        if (!integer(source) || source >= sources.length || !integer(line) || !integer(column)) throw new Error('Invalid original position.');
        if (fields.length === 5) { name += fields[4]; if (!integer(name) || name >= (map.names?.length ?? 0)) throw new Error('Invalid name index.'); }
        return { generated, original: { path: sources[source], line: line + 1, column } };
      });
    });
    return { ok: true, position(point) {
      if (!integer(point.line) || point.line < 1 || !integer(point.column)) return null;
      const segments = lines[point.line - 1] ?? [];
      let low = 0, high = segments.length;
      while (low < high) { const middle = (low + high) >> 1; if (segments[middle].generated <= point.column) low = middle + 1; else high = middle; }
      return segments[low - 1]?.original ?? null;
    } };
  } catch (error) { return { ok: false, error: error.message }; }
}

/** Remap complete ranges only. A range across sources or unmapped positions is not evidence. */
export function mapRange(decoder, range) {
  if (!range) return null;
  const start = decoder.position(range.start), end = decoder.position(range.end);
  if (!start || !end || start.path !== end.path || end.line < start.line || (end.line === start.line && end.column < start.column)) return null;
  return { path: start.path, start: { line: start.line, column: start.column }, end: { line: end.line, column: end.column } };
}

/** Split one mapped Istanbul entry by original source. Count each skipped measurement explicitly. */
export function remapEntry(entry) {
  const decoder = decodeSourceMap(entry.inputSourceMap, entry.path), files = new Map();
  let unmapped = 0;
  if (!decoder.ok) return { files: [], unmapped: entry.statements.length + entry.functions.length + entry.branches.reduce((n, b) => n + b.paths.length, 0), error: decoder.error };
  const file = (path) => { if (!files.has(path)) files.set(path, { path, statements: [], functions: [], branches: [] }); return files.get(path); };
  for (const statement of entry.statements) {
    const mapped = mapRange(decoder, statement);
    if (mapped) file(mapped.path).statements.push({ ...statement, start: mapped.start, end: mapped.end }); else unmapped++;
  }
  for (const fn of entry.functions) {
    const decl = mapRange(decoder, fn.decl), loc = mapRange(decoder, fn.loc);
    if (decl && loc && decl.path === loc.path) file(decl.path).functions.push({ ...fn, decl, loc }); else unmapped++;
  }
  for (const branch of entry.branches) {
    const loc = mapRange(decoder, branch.loc);
    for (const [index, arm] of branch.paths.entries()) {
      const location = arm.location ? mapRange(decoder, arm.location) : loc;
      if (loc && location && loc.path === location.path) file(loc.path).branches.push({ ...branch, loc,
        paths: [{ ...arm, index, location: arm.location ? location : null }] }); else unmapped++;
    }
  }
  return { files: [...files.values()], unmapped };
}
