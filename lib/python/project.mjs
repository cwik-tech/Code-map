// Python source roots and pytest paths from snapshot configuration. No project imports.
import { posix } from 'node:path';
import { matchesGlob } from '../glob.mjs';
import { ignored, underRoots } from '../project.mjs';

const quoted = (text) => [...text.matchAll(/["']([^"']*)["']/g)].map((m) => m[1]);
function section(text, name) {
  const lines = text.split(/\r?\n/), result = [];
  let active = false;
  for (const line of lines) {
    if (/^\s*\[/.test(line)) active = line.trim() === `[${name}]`;
    else if (active) result.push(line);
  }
  return result.join('\n');
}
function value(text, key) {
  return new RegExp(`^\\s*${key}\\s*=\\s*(\\[[\\s\\S]*?\\]|[^\\n]+)`, 'm').exec(text)?.[1] ?? '';
}
const safeRoot = (root) => root && !posix.isAbsolute(root) && !root.split('/').includes('..');
export function pythonRoots(paths, config, toml = '') {
  if (Array.isArray(config.roots) && config.roots.length) return config.roots.map((r) => r.replace(/\/+$/, ''));
  const roots = ['.'];
  if (paths.some((p) => p.startsWith('src/') && p.endsWith('.py'))) roots.push('src');
  roots.push(...quoted(value(section(toml, 'tool.setuptools.packages.find'), 'where')));
  const dir = section(toml, 'tool.setuptools.package-dir');
  roots.push(...quoted(/^\s*["']{2}\s*=\s*(.+)$/m.exec(dir)?.[1] ?? ''));
  roots.push(...quoted(value(section(toml, 'tool.setuptools'), 'package-dir')).filter((p) => p !== ''));
  const poetry = value(section(toml, 'tool.poetry'), 'packages');
  roots.push(...[...poetry.matchAll(/\bfrom\s*=\s*["']([^"']+)["']/g)].map((m) => m[1]));
  for (const part of ['tool.hatch.build', 'tool.hatch.build.targets.wheel']) {
    roots.push(...quoted(value(section(toml, part), 'packages')).map(posix.dirname));
  }
  return [...new Set(roots.filter(safeRoot).map((r) => posix.normalize(r)))];
}
export function pythonTestSelector(parsedSettings = {}) {
  let settings = parsedSettings;
  if (typeof settings._tomlFallback === 'string') {
    const part = section(settings._tomlFallback, 'tool.pytest.ini_options');
    settings = { ...settings, testpaths: quoted(value(part, 'testpaths')), python_files: quoted(value(part, 'python_files')) };
  }
  const words = (v, fallback) => Array.isArray(v) && v.every((s) => typeof s === 'string') && v.length ? v
    : typeof v === 'string' && v.trim() ? v.replace(/["']/g, '').trim().split(/\s+/) : fallback;
  const testpaths = words(settings.testpaths, ['.']), patterns = words(settings.python_files, ['test_*.py', '*_test.py']);
  const isTest = (path) => path.endsWith('.py') && posix.basename(path) !== 'conftest.py' && !ignored(path)
    && patterns.some((pattern) => matchesGlob(pattern.includes('/') ? path : posix.basename(path), pattern));
  const defaultCollected = (path) => isTest(path) && testpaths.some((root) => underRoots(path, [root]) || matchesGlob(path, `${root}/**`));
  return { isTest, defaultCollected };
}
