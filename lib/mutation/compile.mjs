// Read-only generated-file compilation over the requested snapshot. Project code never runs.
import { dirname, join, posix, relative, isAbsolute } from 'node:path';
import { realpathSync, statSync, readFileSync, readdirSync } from 'node:fs';
import ts from 'typescript';
import { sourceReader } from '../git.mjs';

const installedTypeFile = (path) => posix.basename(path) === 'package.json' || /\.d\.[cm]?ts$/.test(path);

/** Read only package metadata and declarations within the canonical installed dependency folder. */
function installedTypes(repository) {
  let root, reason = null, total = 0;
  const cache = new Map();
  try { root = realpathSync(join(repository, 'node_modules')); if (!statSync(root).isDirectory()) root = undefined; }
  catch { /* Missing dependencies are reported as an unavailable type check. */ }
  const resolve = (path) => {
    if (!root || !(path === '/snapshot/node_modules' || path.startsWith('/snapshot/node_modules/'))) return undefined;
    try {
      const full = realpathSync(join(root, path.slice('/snapshot/node_modules'.length)));
      const rel = relative(root, full);
      return rel === '..' || rel.startsWith('../') || isAbsolute(rel) ? undefined : full;
    } catch { return undefined; } // Missing packages and broken links are normal resolution misses.
  };
  return {
    reason: () => root ? reason : 'The repository node_modules folder is unavailable.',
    directoryExists: (path) => { const full = resolve(path); return !!full && statSync(full).isDirectory(); },
    entries: (path) => {
      const full = resolve(path);
      if (!full || !statSync(full).isDirectory()) return { files: [], directories: [] };
      const files = [], directories = [];
      for (const name of readdirSync(full)) {
        const child = resolve(posix.join(path, name));
        if (!child) continue;
        const info = statSync(child);
        if (info.isDirectory()) directories.push(name);
        else if (info.isFile() && installedTypeFile(name)) files.push(name);
      }
      return { files, directories };
    },
    readFile: (path) => {
      if (cache.has(path)) return cache.get(path);
      const full = resolve(path);
      if (!full || !installedTypeFile(path)) return undefined;
      const info = statSync(full);
      if (!info.isFile()) return undefined;
      if (info.size > 8 * 1024 * 1024 || total + info.size > 32 * 1024 * 1024) {
        reason = 'Installed type information exceeds the 8 MiB file limit or 32 MiB total limit.';
        cache.set(path, undefined); return undefined;
      }
      const bytes = readFileSync(full);
      total += bytes.length;
      if (bytes.length > 8 * 1024 * 1024 || total > 32 * 1024 * 1024) {
        reason = 'Installed type information exceeds the 8 MiB file limit or 32 MiB total limit.';
        cache.set(path, undefined); return undefined;
      }
      const text = bytes.toString('utf8'); cache.set(path, text); return text;
    },
  };
}

function diagnosticRecord(diagnostics) {
  const errors = diagnostics.filter((item) => item.category === ts.DiagnosticCategory.Error);
  return { status: errors.length ? 'failed' : 'passed', diagnostics: errors.slice(0, 100).map((item) => ({ code: item.code,
    file: item.file?.fileName.startsWith('/snapshot/') ? item.file.fileName.slice(10) : null,
    line: item.file && item.start !== undefined ? item.file.getLineAndCharacterOfPosition(item.start).line + 1 : null,
    message: ts.flattenDiagnosticMessageText(item.messageText, '\n') })), truncated: errors.length > 100 };
}

/** Syntax/configuration blocks execution. Semantic type diagnostics are information only. */
export function compileGenerated(repository, head, file) {
  const reader = sourceReader(repository, head), paths = reader.list(), dependencies = installedTypes(repository);
  const typed = /\.[cm]?tsx?$/.test(file);
  const selected = typed ? paths.filter((path) => !path.split('/').includes('node_modules') && /\.(?:[cm]?[jt]sx?|json)$/.test(path)) : [file];
  const stats = reader.stat(selected), safe = selected.filter((path) => stats.get(path)?.file && !stats.get(path)?.link && stats.get(path).size <= 8 * 1024 * 1024);
  const texts = new Map([...reader.read(safe)].map(([path, text]) => [posix.join('/snapshot', path), text]));
  const target = posix.join('/snapshot', file), library = dirname(ts.getDefaultLibFilePath({})).replaceAll('\\', '/');
  const normal = (path) => posix.normalize(path.replaceAll('\\', '/'));
  const readFile = (path) => dependencies.readFile(normal(path)) ?? texts.get(normal(path)) ?? (normal(path).startsWith(`${library}/lib.`) ? ts.sys.readFile(path) : undefined);
  const directories = new Set(['/snapshot']);
  for (const path of texts.keys()) for (let folder = posix.dirname(path); folder !== '/'; folder = posix.dirname(folder)) directories.add(folder);
  const entries = (folder) => normal(folder).startsWith('/snapshot/node_modules') ? dependencies.entries(normal(folder)) : ({ files: [...texts.keys()].filter((path) => posix.dirname(path) === normal(folder)).map((path) => posix.basename(path)),
    directories: [...directories].filter((path) => path !== normal(folder) && posix.dirname(path) === normal(folder)).map((path) => posix.basename(path)) });
  const host = { ...ts.createCompilerHost({}), readFile, fileExists: (path) => readFile(path) !== undefined,
    directoryExists: (path) => directories.has(normal(path)) || dependencies.directoryExists(normal(path)) || normal(path) === library, getCurrentDirectory: () => '/snapshot',
    getDirectories: (path) => entries(path).directories, realpath: normal, useCaseSensitiveFileNames: () => true,
    readDirectory: (path, extensions, excludes, includes, depth) => ts.matchFiles(path, extensions, excludes, includes, true, '/snapshot', depth, entries, normal),
    getSourceFile: (path, languageVersion) => { const text = readFile(path); return text === undefined ? undefined : ts.createSourceFile(path, text, languageVersion, true); },
    writeFile: () => { throw new Error('Generated compilation never emits files.'); } };
  const configs = typed ? [...texts.keys()].filter((path) => /^tsconfig(?:\.[^/]+)?\.json$/.test(posix.basename(path)))
    .sort((a, b) => posix.dirname(b).length - posix.dirname(a).length || Number(posix.basename(b) === 'tsconfig.json') - Number(posix.basename(a) === 'tsconfig.json') || a.localeCompare(b)) : [];
  const projects = configs.map((path) => {
    const raw = ts.readConfigFile(path, readFile);
    const parsed = raw.error ? null : ts.parseJsonConfigFileContent(raw.config, { ...host, useCaseSensitiveFileNames: true }, posix.dirname(path), {}, path);
    return { path, parsed, error: raw.error };
  });
  const project = projects.find((item) => item.parsed?.fileNames.includes(target))
    ?? projects.find((item) => posix.basename(item.path) === 'tsconfig.json' && target.startsWith(`${posix.dirname(item.path)}/`));
  const config = project ? project.path.slice(10) : null;
  let options = project?.parsed?.options ?? {};
  const diagnostics = project?.error ? [project.error] : (project?.parsed?.errors ?? []).filter((item) => item.code !== 18003);
  options = { ...options, noEmit: true, noCheck: false, allowJs: true, checkJs: false, incremental: false, composite: false, tsBuildInfoFile: undefined,
    ...(ts.versionMajorMinor === '6.0' ? { ignoreDeprecations: '6.0' } : {}) };
  const program = ts.createProgram([target], options, host), source = program.getSourceFile(target);
  if (!source) return { status: 'unavailable', config, diagnostics: [], reason: 'The generated file is missing, a symlink, or larger than 8 MiB.',
    typeCheck: { status: 'unavailable', reason: 'The generated source is unavailable.' } };
  // TypeScript includes missing configured type packages in options diagnostics (TS2688). They are type information.
  const optionDiagnostics = program.getOptionsDiagnostics();
  diagnostics.push(...optionDiagnostics.filter((item) => item.code !== 2688), ...program.getSyntacticDiagnostics(source));
  const semantics = typed ? [...optionDiagnostics.filter((item) => item.code === 2688),
    ...program.getGlobalDiagnostics(), ...program.getSemanticDiagnostics(source)] : [];
  const reason = typed ? dependencies.reason() : 'JavaScript receives syntax checks only.';
  return { ...diagnosticRecord(diagnostics), config,
    typeCheck: reason ? { status: 'unavailable', reason } : diagnosticRecord(semantics) };
}
