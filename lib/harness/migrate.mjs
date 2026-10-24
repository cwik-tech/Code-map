// Runs SQL only from the fixed entry point inside the restricted worker.
import { isDeepStrictEqual } from 'node:util';
import { fileBytes } from './files.mjs';
const quote = (name) => '"' + name.replaceAll('"', '""') + '"';
function counts(db) {
  const tables = db.prepare("SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT GLOB 'sqlite_*' ORDER BY name").all();
  if (tables.length > 500) throw new Error('Migration row counts exceed 500 tables');
  return tables.map(({ name }) => ({ table: name, rows: db.prepare(`SELECT count(*) AS rows FROM ${quote(name)}`).get().rows }));
}
function sql(root, path) {
  const text = fileBytes(root, path, 1048576).toString('utf8');
  // Refuse file-backed database operations even inside the restricted workspace.
  if (/\b(ATTACH|DETACH|VACUUM|load_extension|readfile|writefile)\b/i.test(text)) throw new Error('SQL file operations are unsupported by the in-memory migration harness');
  return text;
}
/** Applies the fixture, then the ordered change. Errors retain the last observed row counts. */
export async function migrate(root, spec, metadata) {
  const result = { status: 'UNKNOWN', before: [], after: [], applied: [], failedFile: null, checks: [] };
  if (metadata.status !== 'KNOWN') return { ...result, reason: metadata.reason };
  let DatabaseSync;
  try { ({ DatabaseSync } = await import('node:sqlite')); }
  catch { return { ...result, reason: 'node:sqlite is unavailable. Use Node.js 22.5 or later.' }; }
  const db = new DatabaseSync(':memory:');
  try {
    db.exec('PRAGMA temp_store = MEMORY; PRAGMA foreign_keys = ON;');
    result.failedFile = spec.fixture;
    db.exec(sql(root, spec.fixture));
    result.before = counts(db);
    for (const path of metadata.files) {
      result.failedFile = path;
      db.exec(sql(root, path));
      result.applied.push(path);
    }
    result.failedFile = null;
    db.exec('PRAGMA query_only = ON;');
    for (const assertion of spec.assertions ?? []) {
      if (!/^\s*SELECT\b/i.test(assertion.query) || /\b(load_extension|readfile|writefile)\b/i.test(assertion.query)) throw new Error('Only read-only SELECT assertions are supported');
      const actual = [];
      for (const row of db.prepare(assertion.query).iterate()) {
        actual.push({ ...row });
        if (actual.length > 1000 || Buffer.byteLength(JSON.stringify(actual)) > 200000) throw new Error('Assertion results exceed their row or byte limit');
      }
      result.checks.push({ query: assertion.query, expected: assertion.rows, actual, status: isDeepStrictEqual(actual, assertion.rows) ? 'PASS' : 'FAIL' });
    }
    if (!result.checks.length) { result.status = 'UNKNOWN'; result.reason = 'No transformed-data oracle was declared.'; }
    else if (result.checks.some((check) => check.status === 'FAIL')) { result.status = 'FAIL'; result.error = 'Transformed data differs from the declared oracle.'; }
    else result.status = 'PASS';
  } catch (error) { result.status = 'FAIL'; result.error = error.message.slice(0, 4096); }
  try { result.after = counts(db); }
  catch (error) { result.status = 'UNKNOWN'; result.reason = error.message.slice(0, 4096); }
  finally { db.close(); }
  return result;
}
