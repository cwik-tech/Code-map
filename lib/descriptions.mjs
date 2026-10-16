// Plain-language explanations of top-level folders, folders and files, and whether each one is still current.
// A file description is "stale" when the file's exported names changed after it was written.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const isRecord = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);

export function loadDescriptions(path) {
  if (!existsSync(path)) return { modules: {}, folders: {}, files: {}, tour: [] };
  const parsed = JSON.parse(readFileSync(path, 'utf8'));
  if (!isRecord(parsed)) throw new Error(`${path}: expected an object`);
  const files = {};
  for (const [key, value] of Object.entries(isRecord(parsed.files) ? parsed.files : {})) {
    files[key] = typeof value === 'string' ? { summary: value } : value;
  }
  return { modules: isRecord(parsed.modules) ? parsed.modules : {}, folders: isRecord(parsed.folders) ? parsed.folders : {},
    files, tour: Array.isArray(parsed.tour) ? parsed.tour : [] };
}

export function apiFingerprint(facts) {
  return createHash('sha256').update(facts.exports.join('\n')).digest('hex').slice(0, 12);
}

export function descriptionStatus(text, facts) {
  if (!text || !text.summary || text.summary.trim().length === 0) return 'missing';
  if (text.api !== undefined && text.api !== apiFingerprint(facts)) return 'stale';
  return 'current';
}

export function stampDescriptions(path, descriptions, files, all) {
  let stamped = 0;
  for (const facts of files) {
    const text = descriptions.files[facts.path];
    if (!text || (text.api !== undefined && !all)) continue;
    text.api = apiFingerprint(facts);
    stamped += 1;
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(descriptions, null, 2) + '\n');
  return stamped;
}

/** A Markdown work list that a person or an agent can use to write missing descriptions. */
export function todoReport(descriptions, files, descriptionsPath) {
  const lines = ['# Code map: descriptions to write or review', '',
    `Write one plain-language sentence per file in \`${descriptionsPath}\` under "files", keyed by path,`,
    'then run `code-map stamp`.', ''];
  for (const facts of files) {
    const status = descriptionStatus(descriptions.files[facts.path], facts);
    if (status === 'current') continue;
    lines.push(`## ${facts.path} (${status}, ${facts.lines} lines)`);
    if (status === 'stale') lines.push(`Current description: ${descriptions.files[facts.path].summary}`);
    if (facts.header) lines.push(`Header comment: ${facts.header.replace(/\s+/g, ' ')}`);
    lines.push(`Exports: ${facts.exports.join(', ') || '(none)'}`, '');
  }
  return lines.join('\n');
}
