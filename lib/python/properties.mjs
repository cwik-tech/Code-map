// Static property evidence. JUnit alone supplies observed test outcomes.
import { plain } from '../verify-markdown.mjs';
import { posix } from 'node:path';
const unknown = (reason) => ({ state: 'UNKNOWN', reason });
const versionText = (value) => typeof value === 'string' && value.length <= 4096
  && /^[~^<>=!\s(]*(?:v?\d|\*)[0-9A-Za-z.!+~^<>=,|*\s()-]*$/i.test(value);
const defaultFact = () => ({ state: 'default', reason: 'Hypothesis default for the declared version.' });
const literalLimit = (key, fact) => {
  if (fact.state !== 'literal') return fact;
  const value = fact.value;
  const valid = key === 'max_examples' ? Number.isSafeInteger(value) && value > 0
    : key === 'deadline' ? value === null || typeof value === 'number' && Number.isFinite(value) && value >= 0
      : key === 'derandomize' ? typeof value === 'boolean'
        : Array.isArray(value) && value.every((phase) => ['explicit', 'reuse', 'generate', 'target', 'shrink', 'explain'].includes(phase));
  return valid ? fact : unknown(`Invalid literal ${key} setting.`);
};

export function hypothesisVersion(texts) {
  const versions = [], locks = [];
  for (const [path, text] of texts) {
    if (!/(?:^|\/)(?:pyproject\.toml|requirements[^/]*\.txt|uv\.lock|poetry\.lock|Pipfile(?:\.lock)?)$/.test(path)) continue;
    let section = '', list = false;
    const dependencyLines = [];
    for (const rawLine of text.split('\n')) {
      const line = rawLine.replace(/#.*$/, '').trim();
      const header = /^\[([^\]]+)\]$/.exec(line);
      if (header) { section = header[1]; list = false; continue; }
      if (/requirements[^/]*\.txt$/.test(path)) {
        if (/^hypothesis(?:\[|\s*[~<>=!])/i.test(line)) dependencyLines.push(line);
        continue;
      }
      const mapping = /^tool\.poetry\.(?:group\.[^.]+\.)?(?:dev-)?dependencies$/.test(section) || /^(?:dev-)?packages$/.test(section);
      if (mapping && /^hypothesis\s*=/i.test(line)) dependencyLines.push(line);
      const arrays = ['project.optional-dependencies', 'dependency-groups'].includes(section)
        || section === 'project' && /^dependencies\s*=/.test(line)
        || section === 'tool.uv' && /^dev-dependencies\s*=/.test(line);
      if (arrays && line.includes('[')) list = true;
      if (list) dependencyLines.push(line);
      if (line.endsWith(']')) list = false;
    }
    const declarations = dependencyLines.join('\n');
    for (const match of declarations.matchAll(/(?:^|["'])\s*hypothesis(?:\[[^\]]*\])?\s*((?:[~^<>=!]+\s*\d[\w.*+!-]*(?:\s*,\s*)?)+)/gmi)) versions.push(match[1].trim());
    for (const match of declarations.matchAll(/^\s*hypothesis\s*=\s*["']([^"']+)["']/gmi)) versions.push(match[1]);
    for (const match of declarations.matchAll(/^\s*hypothesis\s*=\s*\{[^}]*\bversion\s*=\s*["']([^"']+)["']/gmi)) versions.push(match[1]);
    if (/(?:uv|poetry)\.lock$/.test(path)) {
      for (const match of text.matchAll(/^name\s*=\s*["']hypothesis["']\s*\nversion\s*=\s*["']([^"']+)["']/gm)) locks.push(`==${match[1]}`);
    }
    if (path.endsWith('Pipfile.lock')) {
      try {
        const value = JSON.parse(text);
        for (const group of [value?.default, value?.develop]) {
          const version = group?.hypothesis?.version;
          if (typeof version === 'string') locks.push(version);
        }
      } catch { /* A malformed lock has no version evidence. */ }
    }
  }
  const unique = [...new Set(versions.filter(versionText))], pinned = [...new Set(locks.filter(versionText))];
  if (locks.some((value) => !versionText(value))) return unknown('Unresolved Hypothesis lock version.');
  if (pinned.length > 1) return unknown('Conflicting Hypothesis lock pins.');
  if (pinned.length === 1) return { state: 'locked', value: pinned[0], declarations: unique };
  return unique.length === 1 ? { state: 'declared', value: unique[0] } : unknown(unique.length ? 'Conflicting Hypothesis declarations.' : 'No declared or locked Hypothesis version.');
}

export function resolveProperties(raw, files, version) {
  const ancestors = files.filter((f) => posix.basename(f.path) === 'conftest.py'
    && (posix.dirname(f.path) === '.' || raw.path.startsWith(posix.dirname(f.path) + '/'))).sort((a, b) => a.path.split('/').length - b.path.split('/').length);
  const profiles = new Map();
  let inherited = {}, unresolved = false;
  for (const file of [...ancestors, raw]) {
    for (const p of file.properties.profiles) if (p.name.state === 'literal') profiles.set(p.name.value, p.settings);
    for (const load of file.properties.loads) {
      unresolved = load.state !== 'literal' || !profiles.has(load.value);
      inherited = unresolved ? {} : profiles.get(load.value);
    }
  }
  return raw.properties.tests.map((test) => {
    const merged = { ...(test.settings._unknown ? {} : inherited), ...test.settings };
    const settings = Object.fromEntries(['max_examples', 'deadline', 'derandomize', 'phases'].map((key) => [key, literalLimit(key, merged[key] ?? (unresolved || merged._unknown ? unknown('Unresolved loaded profile or settings parent.') : defaultFact()))]));
    const seed = test.seed ? test.seed.state === 'literal' && (Number.isSafeInteger(test.seed.value) || test.seed.integerText === true && typeof test.seed.value === 'string' && /^-?\d+$/.test(test.seed.value)) ? { state: 'fixed', value: test.seed.value, literal: test.seed.source, source: '@seed' } : { ...unknown('Computed seed.'), source: '@seed' }
      : settings.derandomize.state === 'literal' ? typeof settings.derandomize.value !== 'boolean' ? unknown('Invalid derandomize setting.')
        : settings.derandomize.value ? { state: 'fixed', value: null, source: 'derandomize=True' } : { state: 'random' }
        : settings.derandomize.state === 'UNKNOWN' ? unknown(settings.derandomize.reason) : { state: 'random' };
    const phases = settings.phases;
    return { ...test, settings, seed, version,
      shrink: phases.state === 'literal' && Array.isArray(phases.value) ? phases.value.includes('shrink') ? 'enabled' : 'disabled' : phases.state === 'UNKNOWN' ? 'UNKNOWN' : 'default' };
  });
}

export function propertyEvidence(analysis, changed = null, reports = []) {
  const seedFor = (c) => {
    const matched = reports.filter((r) => (r.cases ?? []).some((item) => item.file === c.path
      && (item.name === c.name || item.name.startsWith(c.name + '['))
      && (!c.suite || item.suite === c.suite || item.suite?.endsWith('.' + c.suite))));
    const seeds = matched.map((r) => {
      const words = r.run?.command ?? [], inline = words.find((w) => /^--hypothesis-seed=\d+$/.test(w));
      const index = words.indexOf('--hypothesis-seed');
      return inline?.split('=')[1] ?? (index >= 0 && /^\d+$/.test(words[index + 1] ?? '') ? words[index + 1] : null);
    });
    return seeds.length && seeds.every((seed) => seed !== null && seed === seeds[0]) ? seeds[0] : null;
  };
  const byPath = new Map([...analysis.files, ...(analysis.importFiles ?? [])].map((f) => [f.path, f]));
  const targets = (file) => (file?.imports ?? []).map((p) => typeof p === 'string' ? p : p.target).filter(Boolean);
  const byTest = new Map();
  for (const c of analysis.tests?.cases ?? []) if (c.property) {
    if (!byTest.has(c.path)) byTest.set(c.path, []);
    byTest.get(c.path).push(c);
  }
  const tests = (analysis.tests?.testFiles ?? []).flatMap((file) => {
    const cases = byTest.get(file.path);
    if (!cases) return [];
    const reached = new Set(), queue = targets(byPath.get(file.path));
    for (let index = 0; index < queue.length; index++) {
      const path = queue[index];
      if (reached.has(path)) continue;
      reached.add(path);
      queue.push(...targets(byPath.get(path)).filter((p) => !reached.has(p)));
    }
    const modules = [...reached].filter((p) => changed === null || changed.includes(p)).sort();
    if (changed !== null && !modules.length) return [];
    return cases.map((c) => {
      const runSeed = seedFor(c);
      return { ...c.property, path: file.path, name: c.name, suite: c.suite, modules,
        ...(runSeed !== null && c.property.seed.state !== 'fixed' && c.property.seed.source !== '@seed' ? { seed: { state: 'fixed', value: runSeed, source: 'bound command' } } : {}) };
    });
  });
  return { count: tests.length, fixed: tests.filter((t) => t.seed.state === 'fixed').length, random: tests.filter((t) => t.seed.state === 'random').length,
    unknown: tests.filter((t) => t.seed.state === 'UNKNOWN').length, retainedExamples: tests.reduce((n, t) => n + t.examples.length, 0), tests };
}

export function propertyLines(info, limit = 10) {
  if (!info?.count) return [];
  return ['## Python property tests', '', `${info.count} property tests reach changed modules. Fixed seeds: ${info.fixed}. Random seeds: ${info.random}. UNKNOWN seeds: ${info.unknown}. Retained examples: ${info.retainedExamples}.`,
    'Static information only. Outcomes come from bound JUnit reports. No check or rating reads these property facts.',
    ...info.tests.slice(0, limit).map((t) => `${plain(t.path)}: ${t.suite ? plain(t.suite) + '.' : ''}${plain(t.name)}. Seed: ${t.seed.state}.${t.seed.state === 'random' ? ' Random seed reproducibility lead.' : ''} Limits: ${plain(JSON.stringify(t.settings), 1200)}. Shrink: ${t.shrink}.`), ''];
}
