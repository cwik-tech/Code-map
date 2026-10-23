// Forbidden import directions from the "rules" in .code-map.json, for example "verify -> engine".
// The viewer and the JSON reports read the same result. An import is a possible dependency, not a proven call.
import { commonFolder } from './test-quality.mjs';

/** "from -> to", split at the first arrow. A pattern with two lazy groups backtracks for a long time on long runs of spaces. */
function parseRule(text) {
  const arrow = text.indexOf('->'), from = arrow < 0 ? '' : text.slice(0, arrow).trim(), to = arrow < 0 ? '' : text.slice(arrow + 2).trim();
  return from && to ? { text, from, to } : null;
}

/**
 * Each side is a module (the first folder below the common source folder), a folder or file path below it, or "*".
 * `base` is that common folder. A new file in a shallower folder moves it and changes every module, so a comparison checks it.
 */
export function ruleViolations(files, texts = []) {
  const parsed = texts.map((text) => ({ text, rule: parseRule(text) }));
  const rules = parsed.filter((entry) => entry.rule).map((entry) => entry.rule);
  const base = commonFolder(files.map((file) => file.path));
  const rest = (path) => base && path.startsWith(base + '/') ? path.slice(base.length + 1) : path;
  const moduleOf = (path) => { const tail = base ? path.slice(base.length + 1) : path; return tail.includes('/') ? tail.split('/')[0] : null; };
  const matches = (token, path) => token === '*' || moduleOf(path) === token || rest(path) === token || rest(path).startsWith(token.replace(/\/$/, '') + '/');
  const sources = new Set(files.map((file) => file.path)), violations = [];
  for (const file of files) for (const target of file.imports) {
    if (!sources.has(target)) continue;
    for (const rule of rules) {
      if (!matches(rule.from, file.path) || !matches(rule.to, target)) continue;
      if (rule.to === '*' && moduleOf(file.path) === moduleOf(target)) continue;
      if (rule.to !== '*' && matches(rule.to, file.path)) continue; // both sides inside the forbidden target
      const lines = [...new Set((file.edges ?? []).filter((edge) => edge.target === target).map((edge) => edge.line).filter((line) => line !== null))].sort((a, b) => a - b);
      violations.push({ rule: rule.text, from: file.path, to: target, lines });
    }
  }
  return { declared: rules.map((rule) => rule.text), invalid: parsed.filter((entry) => !entry.rule).map((entry) => entry.text), violations, base };
}
