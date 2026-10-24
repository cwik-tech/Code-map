// Explicit SQLite schema snapshots. This parser runs no SQL.
import { digest } from './shared.mjs';
/** Read literal CREATE TABLE snapshots with an explicit SQLite dialect marker. */
export function parseSqlSchema(text) {
  const entities = [], unread = [];
  const unknown = (reason) => unread.push({ reason, lost: true });
  if (!/^\s*--\s*dialect:\s*sqlite\s*$/im.test(text)) {
    unknown('unsupported-or-undeclared-sql-dialect');
    return { entities, unread };
  }
  const clean = text.replace(/--[^\n]*/g, '').trim();
  for (const statement of clean.split(';').map((x) => x.trim()).filter(Boolean)) {
    const table = /^CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([A-Za-z_]\w*)\s*\(([\s\S]+)\)$/i.exec(statement);
    if (!table) { unknown('unsupported-sql-statement'); continue; }
    const columns = [], unsupported = [];
    for (const part of table[2].split(',')) {
      const column = /^\s*([A-Za-z_]\w*)\s+(INTEGER|INT|TEXT|REAL|BLOB|NUMERIC)\b([\s\S]*)$/i.exec(part);
      if (!column) { unsupported.push('unsupported-sql-column'); continue; }
      const modifiers = [], tail = column[3].trim();
      let rest = tail.replace(/\b(NOT\s+NULL|PRIMARY\s+KEY|UNIQUE)\b/gi, (value) => {
        modifiers.push({ name: /^NOT/i.test(value) ? 'notNull' : /^PRIMARY/i.test(value) ? 'primaryKey' : 'unique', args: '' }); return '';
      });
      rest = rest.replace(/\bDEFAULT\s+(NULL|-?\d+(?:\.\d+)?|'[^'\n]*')/gi, (_, value) => { modifiers.push({ name: 'default', args: value }); return ''; });
      if (rest.trim()) unsupported.push('unsupported-sql-constraint');
      columns.push({ name: column[1], column: column[1], builder: column[2].toUpperCase(), args: '', modifiers, line: null });
    }
    entities.push({ name: table[1], type: 'table', dialect: 'sqlite', compatibilityMode: 'conservative-structural', state: unsupported.length ? 'unknown' : 'read',
      reason: unsupported[0] ?? null, columns, line: null, digest: digest(statement), attributes: [], extra: null });
    for (const reason of unsupported) unread.push({ entity: table[1], reason, lost: false });
  }
  if (!entities.length && !unread.length) unknown('empty-sql-snapshot');
  return { entities, unread };
}
