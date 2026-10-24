// CODEOWNERS with the GitHub rules: the owners of each path, and the optional rule against imports between owners from
// the "ownership" of .code-map.json. Pure: the collector reads the file from the snapshot. A line that GitHub does not
// support, such as a negation, is ignored and recorded. Ownership tells who reviews a file. It does not prove a boundary.
import { compileGlob } from './glob.mjs';

/** GitHub looks for the file in these places, in this order, and uses the first one that it finds. */
export const codeownersPaths = ['.github/CODEOWNERS', 'CODEOWNERS', 'docs/CODEOWNERS'];
/** GitHub does not read a CODEOWNERS file of 3 MB or more. */
const maxBytes = 3 * 1024 * 1024;
/** The analysis keeps at most this many characters of an ignored line, so a long line cannot make the summary large. */
const maxText = 200;
/** Each part has one form, so the test is linear in the length of the text. A domain has two or more labels. */
const owner = /^(?:@[A-Za-z0-9][A-Za-z0-9_.-]*(?:\/[A-Za-z0-9][A-Za-z0-9_.-]*)?|[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+)$/;

/** True for a user (@name), a team (@org/name) or an email address. GitHub compares owners without regard to case. */
export const isOwner = (text) => typeof text === 'string' && owner.test(text);

/** The CODEOWNERS file that GitHub reads among the snapshot paths, or null. */
export const findCodeowners = (paths) => codeownersPaths.find((path) => paths.includes(path)) ?? null;

/** The words of one line: whitespace separates them, "\" escapes the next character, and a word that starts with "#" starts a comment. */
function words(line) {
  const list = [];
  let word = null, escaped = false;
  for (const char of line) {
    if (escaped) { word = (word ?? '') + '\\' + char; escaped = false; }
    else if (char === '\\') escaped = true;
    else if (/\s/.test(char)) { if (word !== null) list.push(word); word = null; }
    else if (char === '#' && word === null && list.length) break;
    else word = (word ?? '') + char;
  }
  if (word !== null) list.push(word);
  return { list, escaped };
}

/** The pattern without its escapes, or the reason why Code-map ignores the line. */
function patternOf(word) {
  if (word.startsWith('!')) return { reason: 'GitHub does not support a negated pattern ("!").' };
  if (/[[\]]/.test(word)) return { reason: 'GitHub does not support a character range ("[ ]").' };
  if (/\\[^# ]/.test(word)) return { reason: 'Code-map supports only the escapes "\\#" and "\\ " in a pattern.' };
  const pattern = word.replace(/\\([# ])/g, '$1');
  return pattern.replace(/\//g, '') ? { pattern } : { reason: 'The pattern names no path.' };
}

/**
 * `{ rules: [{ line, pattern, owners }], ignored: [{ line, text, reason }] }` in file order. A rule without owners is valid.
 * The owners are in lowercase, because GitHub compares them without regard to case.
 */
export function parseCodeowners(text) {
  const rules = [], ignored = [];
  if (Buffer.byteLength(text, 'utf8') >= maxBytes) return { rules, ignored: [{ line: null, text: '', reason: 'The file is 3 MB or larger, and GitHub does not read it.' }] };
  text.split(/\r?\n/).forEach((raw, index) => {
    const line = index + 1, trimmed = raw.trim(), shown = trimmed.length > maxText ? `${trimmed.slice(0, maxText)}…` : trimmed;
    if (!trimmed || trimmed.startsWith('#')) return;
    const { list, escaped } = words(trimmed);
    if (escaped) { ignored.push({ line, text: shown, reason: 'The line ends with an incomplete escape.' }); return; }
    const [first, ...owners] = list, parsed = patternOf(first), wrong = owners.find((item) => !isOwner(item));
    if (parsed.reason) ignored.push({ line, text: shown, reason: parsed.reason });
    else if (wrong !== undefined) ignored.push({ line, text: shown, reason: `"${wrong.length > maxText ? `${wrong.slice(0, maxText)}…` : wrong}" is not a user (@name), a team (@org/name) or an email address.` });
    else rules.push({ line, pattern: parsed.pattern, owners: [...new Set(owners.map((name) => name.toLowerCase()))] });
  });
  return { rules, ignored };
}

/**
 * The glob of a pattern, with the gitignore rules that GitHub uses. A pattern with a "/" at the start or in the middle starts at
 * the root. Other patterns match at any depth. A pattern that ends with "/" matches only the files in a folder. A
 * matching directory also matches its descendants.
 */
function globOf(pattern) {
  let end = pattern.length;
  while (pattern[end - 1] === '/') end--; // a loop, because the expression /\/+$/ is quadratic on a long run of "/"
  const folder = end < pattern.length, text = pattern.slice(0, end), anchored = text.includes('/'), base = anchored ? text.replace(/^\/+/, '') : `**/${text}`;
  return folder ? `${base}/**/*` : `${base}/**`;
}

/** A function from a path to `{ owners, line }`: the owners of the last rule that matches, or no owners and line null. */
export function ownerMatcher(rules) {
  const compiled = rules.map((rule) => ({ ...rule, matches: compileGlob(globOf(rule.pattern)) })).reverse();
  return (path) => { const rule = compiled.find((entry) => entry.matches(path)); return rule ? { owners: rule.owners, line: rule.line } : { owners: [], line: null }; };
}

/** The import lines from one file to one target, as in lib/rules.mjs. */
const linesOf = (file, target) => [...new Set((file.edges ?? []).filter((edge) => edge.target === target).map((edge) => edge.line).filter((line) => line !== null))].sort((a, b) => a - b);

/**
 * The ownership section of an analysis, or null without a CODEOWNERS file and without the setting. `codeowners` is the file
 * of the snapshot ({ path, text }, or { path, problem } when the collector did not read it) or null, and `policy` is the
 * "ownership" of .code-map.json or null. With `forbidCrossOwnerImports`, an import between two owned files without a common
 * owner is a violation, unless an exception allows one owner of the importer to import one owner of the target. A file
 * without an owner is outside this rule. Owners are compared in lowercase, as GitHub does.
 */
export function ownershipOf(files, codeowners, policy) {
  if (!codeowners && !policy) return null;
  const { rules, ignored } = !codeowners ? { rules: [], ignored: [] } : codeowners.problem ? { rules: [], ignored: [{ line: null, text: '', reason: codeowners.problem }] }
    : parseCodeowners(codeowners.text), match = ownerMatcher(rules);
  const owned = new Map(files.map((file) => [file.path, match(file.path)])), sets = new Map([...owned].map(([path, entry]) => [path, new Set(entry.owners)]));
  const allowed = (policy?.allowed ?? []).map(({ from, to }) => [from.toLowerCase(), to.toLowerCase()]), violations = [];
  if (policy?.forbidCrossOwnerImports === true) for (const file of files) for (const target of file.imports) {
    const from = sets.get(file.path), to = sets.get(target);
    if (!from.size || !to?.size || [...from].some((name) => to.has(name)) || allowed.some(([one, other]) => from.has(one) && to.has(other))) continue;
    violations.push({ from: file.path, to: target, owners: { from: owned.get(file.path).owners, to: owned.get(target).owners }, lines: linesOf(file, target) });
  }
  const values = [...owned.values()];
  return { file: codeowners?.path ?? null, rules, ignored, files: Object.fromEntries(owned), unowned: values.filter((entry) => !entry.owners.length).length,
    owners: [...new Set(values.flatMap((entry) => entry.owners))].sort(),
    policy: policy ? { forbidCrossOwnerImports: policy.forbidCrossOwnerImports === true, allowed: (policy.allowed ?? []).map(({ from, to }) => ({ from, to })) } : null, violations };
}
