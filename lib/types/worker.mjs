// Compiler worker over a virtual snapshot. Only the installed compiler library files come from disk.
import { readFileSync } from 'node:fs';
import { dirname, posix } from 'node:path';
import ts from 'typescript';
import { exampleBlocks, exampleResolver, exampleDiagnostics } from './examples.mjs';
import { compilerFacts } from './program.mjs';

// The program only reads and checks, it never emits. Thus the emit settings of a build (incremental, composite) do not apply.
// TypeScript 6 reports some options of TypeScript 5 projects as deprecated (baseUrl, moduleResolution node10). They still work in 6.
const analysisOptions = (options) => ({ ...options, noEmit: true, incremental: false, composite: false, tsBuildInfoFile: undefined,
  ...(ts.versionMajorMinor === '6.0' ? { ignoreDeprecations: '6.0' } : {}) });

const input = JSON.parse(readFileSync(0, 'utf8'));
if (!Array.isArray(input) || input.some((pair) => !Array.isArray(pair) || pair.length !== 2
  || pair.some((value) => typeof value !== 'string') || pair[0].startsWith('/') || pair[0].split('/').includes('..'))) {
  throw new Error('Invalid snapshot texts.');
}
const texts = new Map(input.map(([path, text]) => [posix.join('/snapshot', path), text]));
const extracted = exampleBlocks(new Map(input));
const blocks = extracted.filter((block) => !block.skip).map((block, index) => ({ ...block, virtual: posix.join('/snapshot', posix.dirname(block.path), `.code-map-example-${index}.${block.language}`) }));
for (const block of blocks) texts.set(block.virtual, `${block.code}\nexport {};`);
const examples = { state: 'COMPLETE', checked: 0, skipped: extracted.filter((block) => block.skip).length, issues: [], gaps: [] };
const pending = new Set(blocks);
const library = dirname(ts.getDefaultLibFilePath({})).replaceAll('\\', '/');
const normal = (path) => posix.normalize(path.replaceAll('\\', '/'));
const readFile = (path) => texts.get(normal(path)) ?? (normal(path).startsWith(`${library}/lib.`) ? ts.sys.readFile(path) : undefined);
const directories = new Set(['/snapshot']);
for (const path of texts.keys()) for (let folder = posix.dirname(path); folder !== '/'; folder = posix.dirname(folder)) directories.add(folder);
const entries = (folder) => ({
  files: [...texts.keys()].filter((path) => posix.dirname(path) === normal(folder)).map((path) => posix.basename(path)),
  directories: [...directories].filter((path) => path !== normal(folder) && posix.dirname(path) === normal(folder)).map((path) => posix.basename(path)),
});
// TypeScript 6.0.3 exports matchFiles and uses this function in its own system readDirectory.
const readDirectory = (path, extensions, excludes, includes, depth) => ts.matchFiles(path, extensions, excludes, includes, true, '/snapshot', depth, entries, normal);
const host = { useCaseSensitiveFileNames: true, readFile, fileExists: (path) => readFile(path) !== undefined, readDirectory,
  directoryExists: (path) => directories.has(normal(path)) || normal(path) === library,
  getCurrentDirectory: () => '/snapshot', getDirectories: (path) => entries(path).directories,
  realpath: normal };
const configs = [...texts.keys()].filter((path) => /^tsconfig(?:\.[^/]+)?\.json$/.test(posix.basename(path))).sort();
const result = { state: configs.length ? 'COMPLETE' : 'UNKNOWN', ...(configs.length ? {} : { reason: 'no-tsconfig' }),
  programs: [], exports: {}, calls: [], references: [], examples };
for (const config of configs) {
  const raw = ts.readConfigFile(config, readFile);
  const parsed = raw.error ? null : ts.parseJsonConfigFileContent(raw.config, host, posix.dirname(config), {}, config);
  if (!parsed || parsed.errors.length) {
    result.state = 'UNKNOWN'; result.reason = 'config';
    result.programs.push({ config: config.slice(10), state: 'UNKNOWN', files: [] });
    continue;
  }
  // noCheck explicitly disables checking. Such a program cannot attest checked files.
  if (parsed.options.noCheck) {
    result.state = 'UNKNOWN'; result.reason = 'noCheck';
    result.programs.push({ config: config.slice(10), state: 'UNKNOWN', files: [] });
    continue;
  }
  const selected = [...pending].filter((block) => {
    const candidates = configs.filter((path) => block.virtual.startsWith(`${posix.dirname(path)}/`))
      .sort((a, b) => posix.dirname(b).length - posix.dirname(a).length
        || Number(posix.basename(b) === 'tsconfig.json') - Number(posix.basename(a) === 'tsconfig.json') || a.localeCompare(b));
    return candidates[0] === config;
  });
  const settings = analysisOptions(parsed.options);
  const serviceHost = { ...host, useCaseSensitiveFileNames: () => true, getCompilationSettings: () => settings, getScriptFileNames: () => [...parsed.fileNames.filter((path) => !blocks.some((block) => block.virtual === path)), ...selected.map((block) => block.virtual)],
    resolveModuleNameLiterals: exampleResolver(texts, host, settings, new Set(blocks.map((block) => block.virtual))),
    getScriptVersion: () => '0', getProjectReferences: () => parsed.projectReferences, getDefaultLibFileName: ts.getDefaultLibFilePath,
    getScriptSnapshot: (path) => { const text = readFile(path); return text === undefined ? undefined : ts.ScriptSnapshot.fromString(text); } };
  const service = ts.createLanguageService(serviceHost);
  const program = service.getProgram();
  if (!program) { result.state = 'UNKNOWN'; result.reason = 'program'; continue; }
  const files = program.getSourceFiles().filter((source) => source.fileName.startsWith('/snapshot/') && !blocks.some((block) => block.virtual === source.fileName));
  const optionsErrors = program.getOptionsDiagnostics().filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error);
  const state = optionsErrors.length ? 'UNKNOWN' : 'COMPLETE';
  result.programs.push({ config: config.slice(10), state, files: state === 'COMPLETE' ? files.filter((source) => (!/\.[cm]?jsx?$/.test(source.fileName) || parsed.options.checkJs || /@ts-check\b/.test(source.text))
    && (!source.isDeclarationFile || !parsed.options.skipLibCheck)).map((source) => source.fileName.slice(10)).sort() : [] });
  if (state === 'UNKNOWN') { result.state = 'UNKNOWN'; result.reason = 'compiler-options'; }
  else {
    compilerFacts(program, service, files, result);
    exampleDiagnostics(program, selected, examples);
    for (const block of selected) pending.delete(block);
  }
  service.dispose();
}
for (const block of pending) examples.gaps.push({ path: block.path, blockLine: block.blockLine, reason: result.reason ?? 'no-program' });
if (pending.size) examples.state = 'UNKNOWN';
const calls = new Map();
for (const call of result.calls) {
  const key = JSON.stringify([call.path, call.line, call.column, call.export]);
  const previous = calls.get(key);
  calls.set(key, previous && previous.compatibility !== call.compatibility ? { ...call, compatibility: 'UNKNOWN' } : call);
}
result.calls = [...calls.values()];
result.references = [...new Map(result.references.map((ref) => [JSON.stringify(ref), ref])).values()];
process.stdout.write(JSON.stringify(result));
