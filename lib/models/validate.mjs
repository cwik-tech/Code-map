// Shared checks of the model files (C23, C24): texts, literal values, repository paths and the optional subject.
// A model file is untrusted input, so each check accepts only the exact form, and the caller collects every problem.
import { posix } from 'node:path';

const maxText = 200;
export const textRule = `must be a text of 1 to ${maxText} characters on one line.`;
export const literalRule = 'must be a text, a number, true, false or null.';
export const isRecord = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);
export const text = (value) => typeof value === 'string' && value.trim().length > 0 && value.length <= maxText && !/[\n\r]/.test(value);
/** A value of a condition or an outcome: a short text, a finite number, a boolean or null. */
export const literal = (value) => value === null || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value)) || (typeof value === 'string' && value.length <= maxText);

/** A path relative to the repository root, in normal form, that cannot leave the repository. */
function repositoryPath(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 500 && !/[\0\\]/.test(value) && !posix.isAbsolute(value)
    && posix.normalize(value) === value && value !== '.' && value !== '..' && !value.startsWith('../') && !value.endsWith('/');
}

/** The problems of the fields of an object that are not in `fields`. */
export function unknownFields(value, fields, at, add) {
  for (const key of Object.keys(value)) if (!fields.includes(key)) add(at ? `${at}.${key}` : key, `is not a known field. The fields are ${fields.join(', ')}.`);
}

/** The problems of a subject: the source file and the export that the model describes. */
export function subjectProblems(subject, add) {
  if (!isRecord(subject)) { add('subject', 'must be an object with file and export.'); return; }
  unknownFields(subject, ['file', 'export'], 'subject', add);
  if (!repositoryPath(subject.file)) add('subject.file', 'must be a path inside the repository, relative to its root, such as src/price.ts.');
  if (!text(subject.export)) add('subject.export', `${textRule} It is the name that the file exports.`);
}
