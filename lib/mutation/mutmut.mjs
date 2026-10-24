// mutmut 3.3.1 results --all true: one mangled function key and status per line.
// Source: https://github.com/boxed/mutmut/blob/3.3.1/mutmut/__main__.py (results).
import { isRelativePath } from '../adapters/run-manifest.mjs';
const statuses = { killed: 'Killed', survived: 'Survived', timeout: 'Timeout', 'no tests': 'NoCoverage',
  skipped: 'Ignored', segfault: 'RuntimeError' };
function functions(files) {
  const keys = new Map();
  const add = (key, value) => keys.set(key, keys.has(key) ? null : value);
  for (const file of files) {
    if (file.language !== 'python' || !isRelativePath(file.path) || typeof file.python?.module !== 'string') continue;
    // mutmut 3.3.1 removes src. and package __init__ from physical module paths.
    const module = file.path.slice(0, -3).replaceAll('/', '.').replace(/^src\./, '').replace(/\.__init__$/, '');
    for (const declaration of file.declarations ?? []) {
      const entries = declaration.kind === 'class' ? (declaration.children ?? []).map((child) => [child, `xǁ${declaration.name}ǁ${child.name}`])
        : [[declaration, `x_${declaration.name}`]];
      for (const [fn, name] of entries) {
        if (!['function', 'method'].includes(fn.kind)) continue;
        add(`${module}.${name}`, { path: file.path, start: fn.start, end: fn.end });
      }
    }
  }
  return keys;
}
/** Reject the entire report on a malformed, ambiguous or unmapped mutant. Unknown statuses never enter the score. */
export function parseMutmut(text, { files = [], maxBytes = 50 * 1024 * 1024, maxMutants = 400000 } = {}) {
  const fail = (error) => ({ ok: false, error });
  if (typeof text !== 'string' || Buffer.byteLength(text) > maxBytes) return fail('The mutmut report exceeds the byte limit.');
  const keys = functions(files), mutants = [], seen = new Set();
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    if (mutants.length >= maxMutants) return fail('The mutmut report exceeds the mutant limit.');
    const match = /^ {4}([^\s:]+)__mutmut_([1-9][0-9]*): ([a-z][a-z ]*)\r?$/.exec(line);
    if (!match || seen.has(`${match[1]}__mutmut_${match[2]}`)) return fail('Invalid mutmut entry.');
    const fn = keys.get(match[1]);
    if (!fn || !Number.isSafeInteger(fn.start) || !Number.isSafeInteger(fn.end) || fn.start < 1 || fn.end < fn.start) return fail('Mutmut location is outside the repository, ambiguous or unavailable.');
    seen.add(`${match[1]}__mutmut_${match[2]}`);
    mutants.push({ path: fn.path, status: Object.hasOwn(statuses, match[3]) ? statuses[match[3]] : 'UNKNOWN',
      originalStatus: match[3], mutator: 'mutmut (operator unavailable)', locationKind: 'function',
      location: { start: { line: fn.start, column: 0 }, end: { line: fn.end + 1, column: 0 } } });
  }
  return { ok: true, report: { generator: 'mutmut', mutants } };
}
