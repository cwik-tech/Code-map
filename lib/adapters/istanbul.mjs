// Reads Istanbul JSON coverage (coverage-final.json), which Istanbul, nyc, c8, Jest and Vitest write. Each file entry has
// statementMap with its counts s, fnMap with f and branchMap with b. The report is untrusted: a missing map, a count that does
// not match its map or a location that is not a line range makes the whole report unreadable. Other fields of an entry, such
// as hash or _coverageSchema, are not read. Pure: no file access, no clock and no execution.

/** Declared producers. The parser checks the shape, not the producer version. */
export const supportedProducers = [{ name: 'Istanbul JSON (coverage-final.json)', versions: 'the statementMap, fnMap and branchMap shape of istanbul-lib-coverage 2 and later' }];
const isRecord = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);
const isCount = (value) => Number.isSafeInteger(value) && value >= 0;
/** A key of the report in a message: JSON-quoted and cut to 200 characters, because the report is untrusted. */
const quoted = (key) => JSON.stringify(key.length > 200 ? `${key.slice(0, 197)}...` : key);

class IstanbulError extends Error {}
const fail = (where, message) => { throw new IstanbulError(`${where}: ${message}`); };

/**
 * Returns `{ ok: true, report: { files } }` or `{ ok: false, error }`. Untrusted input never throws. Each file is
 * { path, sourceMap, statements: [{ id, start, end, count }], functions: [{ id, name, decl, loc, count }], branches: [{ id, type,
 * loc, paths: [{ location, count }] }] }, with `path` as the report gives it. A position is { line, column }: the line counts from 1,
 * and the column counts from 0 or is null. A branch path without a location, such as the else of an if without an else, has
 * `location: null`. `sourceMap` marks generated coordinates. `inputSourceMap` retains untrusted metadata for the remapping boundary.
 */
export function parseIstanbul(text, { maxBytes = 50 * 1024 * 1024 } = {}) {
  if (typeof text !== 'string') return { ok: false, error: 'The coverage report must be text.' };
  if (text.length > maxBytes || Buffer.byteLength(text, 'utf8') > maxBytes) return { ok: false, error: `The coverage report is larger than ${maxBytes} bytes.` };
  let value;
  try { value = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text); } catch { return { ok: false, error: 'The text is not valid JSON.' }; }
  if (!isRecord(value)) return { ok: false, error: 'The coverage report must be a JSON object with one entry for each file.' };
  try {
    return { ok: true, report: { files: Object.entries(value).map(([path, entry]) => readFile(path, entry)) } };
  } catch (error) {
    if (error instanceof IstanbulError) return { ok: false, error: error.message };
    throw error;
  }
}

function readFile(path, entry) {
  const where = `files[${quoted(path)}]`;
  if (path.length === 0) fail('files', 'A file entry has an empty file path.');
  if (!isRecord(entry)) fail(where, 'Must be an object with statementMap, s, fnMap, f, branchMap and b.');
  if (entry.path !== path) fail(`${where}.path`, 'Must be the same path as its key.');
  if (entry.inputSourceMap !== undefined && entry.inputSourceMap !== null && !isRecord(entry.inputSourceMap)) fail(`${where}.inputSourceMap`, 'Must be an object or null.');
  for (const field of ['statementMap', 's', 'fnMap', 'f', 'branchMap', 'b']) if (!isRecord(entry[field])) fail(`${where}.${field}`, 'Must be an object.');
  const statements = paired(entry, 'statementMap', 's', where, (location, count, id, at) => ({ id, ...range(location, at), count: counted(count, `${where}.s[${quoted(id)}]`) }));
  const functions = paired(entry, 'fnMap', 'f', where, (fn, count, id, at) => {
    if (!isRecord(fn)) fail(at, 'Must be an object with a name, a decl and a loc.');
    if (typeof fn.name !== 'string') fail(`${at}.name`, 'Must be a string.');
    return { id, name: fn.name, decl: range(fn.decl, `${at}.decl`), loc: range(fn.loc, `${at}.loc`), count: counted(count, `${where}.f[${quoted(id)}]`) };
  });
  const branches = paired(entry, 'branchMap', 'b', where, (branch, counts, id, at) => {
    if (!isRecord(branch)) fail(at, 'Must be an object with a loc, a type and locations.');
    if (typeof branch.type !== 'string') fail(`${at}.type`, 'Must be a string.');
    if (!Array.isArray(branch.locations) || branch.locations.length === 0) fail(`${at}.locations`, 'Must be an array with at least one location.');
    const loc = range(branch.loc, `${at}.loc`), size = branch.locations.length;
    if (!Array.isArray(counts) || counts.length !== size) fail(`${where}.b[${quoted(id)}]`, `Must be an array of ${size} counts, one for each location in branchMap.`);
    return { id, type: branch.type, loc, paths: branch.locations.map((location, index) => ({ location: range(location, `${at}.locations[${index}]`, true), count: counted(counts[index], `${where}.b[${quoted(id)}][${index}]`) })) };
  });
  return { path, sourceMap: isRecord(entry.inputSourceMap), ...(isRecord(entry.inputSourceMap) ? { inputSourceMap: entry.inputSourceMap } : {}), statements, functions, branches };
}

/** The entries of a map with their counts. Each key of the map needs a count, and each count needs a key of the map. */
function paired(entry, mapName, countName, where, read) {
  const map = entry[mapName], counts = entry[countName];
  for (const id of Object.keys(counts)) if (!Object.hasOwn(map, id)) fail(`${where}.${countName}[${quoted(id)}]`, `Has no entry in ${mapName}.`);
  return Object.keys(map).map((id) => {
    if (!Object.hasOwn(counts, id)) fail(`${where}.${countName}`, `Has no count for the entry ${quoted(id)} of ${mapName}.`);
    return read(map[id], counts[id], id, `${where}.${mapName}[${quoted(id)}]`);
  });
}

function counted(value, where) {
  if (!isCount(value)) fail(where, 'Must be a whole number from 0.');
  return value;
}

/** A location { start, end }. With `empty`, a location whose start and end have no line and no column is null. */
function range(location, where, empty = false) {
  if (!isRecord(location) || !isRecord(location.start) || !isRecord(location.end)) fail(where, 'Must be a location with a start and an end.');
  const blank = (point) => point.line === undefined && point.column === undefined;
  if (empty && (blank(location.start) || blank(location.end))) {
    if (!blank(location.start) || !blank(location.end)) fail(where, 'Must give both a start and an end, or neither.');
    return null;
  }
  const start = position(location.start, `${where}.start`), end = position(location.end, `${where}.end`);
  if (end.line < start.line) fail(where, 'The location ends on a line before its start line.');
  if (end.line === start.line && start.column !== null && end.column !== null && end.column < start.column) fail(where, 'The location ends before its start column.');
  return { start, end };
}

function position(point, where) {
  if (!Number.isSafeInteger(point.line) || point.line < 1) fail(`${where}.line`, 'Must be a whole number from 1.');
  if (point.column !== null && (!Number.isSafeInteger(point.column) || point.column < 0)) fail(`${where}.column`, 'Must be a whole number from 0, or null.');
  return { line: point.line, column: point.column };
}
