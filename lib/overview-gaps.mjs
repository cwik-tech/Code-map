// Evidence gaps and cache limits of a stored analysis. Pure: no filesystem or command.
import { architectureGaps } from './architecture-view.mjs';
import { supplyGaps } from './supply/summary.mjs';

/** The counts of the file cache in the run that made the analysis (lib/file-cache.mjs). An analysis of an older Code-map has none. */
export function cacheLimit(cache) {
  if (!cache) return [];
  const files = cache.hits + cache.misses;
  if (cache.state === 'off') return [`The file cache was off (--no-cache). Code-map parsed all ${files} files.`];
  if (cache.state !== 'on') return [`The file cache was unavailable. Code-map parsed all ${files} files.`];
  return [`The file cache gave the facts of ${cache.hits} of ${files} files. Code-map parsed the other ${cache.misses} files. A cached fact is the same as a new parse of the same file.`];
}

/** Evidence that the analysis could not establish. Each gap names its evidence kind. */
export function gaps(stored) {
  const { analysis, sha } = stored.data, tests = analysis.tests, list = [];
  const add = (key, source, text, count = null) => list.push({ key, source, ...(count === null ? {} : { count }), text });
  add('execution', 'inventory', 'Code-map ran no project test or command. Test links, case statuses and failure-test statuses are static inference, not observed runs.');
  // Files at the top level (folder ".") are configuration files such as vite.config.ts. Only folders can become roots.
  const outsideFolders = (analysis.outsideRoots?.folders ?? []).filter(({ folder }) => folder !== '.');
  const outside = outsideFolders.reduce((sum, { count }) => sum + count, 0);
  if (outside) {
    const named = outsideFolders.slice(0, 10).map(({ folder, count }) => `${folder} (${count})`);
    if (outsideFolders.length > 10) named.push(`${outsideFolders.length - 10} other folders`);
    add('outsideRoots', 'inventory', `${outside} code ${outside === 1 ? 'file' : 'files'} outside the source roots ${outside === 1 ? 'is' : 'are'} not mapped: ${named.join(', ')}. `
      + 'Code-map does not read their imports, findings or test links. Add the folders to "roots" in .code-map.json to map them.', outside);
  }
  // A stack that Code-map does not analyze at all (CSS, other files) gets one short line, not an incomplete-evidence warning each.
  const unread = (analysis.completeness ?? []).filter((row) => !row.supported && row.discovered);
  if (unread.length) add('completeness:unsupported', 'inventory',
    `Code-map does not analyze these files: ${unread.map((row) => `${row.discovered} ${row.stack}`).join(', ')}. They add no import or test evidence.`);
  for (const row of (analysis.completeness ?? []).filter((item) => item.supported)) {
    if (row.skipped || row.malformed || row.dynamicallyUnresolved) add(`completeness:${row.stack}`, 'inventory',
      `${row.stack}: ${row.discovered} discovered, ${row.supported} supported, ${row.parsed} parsed, ${row.skipped} skipped, ${row.malformed} malformed, ${row.dynamicallyUnresolved} dynamically unresolved. Analysis evidence is incomplete.`);
  }
  const coverage = tests?.coverage;
  if (!coverage || coverage.state === 'none') add('coverage', 'measured', 'No coverage report was found, so no line or branch has measured evidence.');
  else if (coverage.state === 'not-applicable') add('coverage', 'measured', `The coverage report applies only to a working-tree analysis. This analysis is of commit ${sha.slice(0, 10)}, so coverage is not used.`);
  else add('coverage', 'measured', `Coverage comes from ${coverage.file}, written ${String(coverage.date).slice(0, 10)}. It is not tied to a revision or a test command.`);
  const edges = analysis.files.flatMap((file) => file.imports);
  const dynamic = edges.filter((edge) => edge.specifier === null && edge.target === null).length, loaders = edges.filter((edge) => edge.target === null && /^\..*[?!]/.test(edge.specifier ?? '')).length;
  if (dynamic) add('dynamicImports', 'graph', 'Dynamic imports with a computed target are not resolved. Dynamic wiring can escape the graph.', dynamic);
  if (loaders) add('loaderImports', 'graph', 'Relative imports with loader syntax (? or !) are not checked for a matching file.', loaders);
  const unchecked = analysis.importNames?.unchecked ?? {}, skipped = Object.values(unchecked).reduce((sum, count) => sum + count, 0);
  if (skipped) add('importNamesUnchecked', 'graph', `Named imports from files whose exports are not all known were not checked: ${Object.entries(unchecked).filter(([, count]) => count).map(([reason, count]) => `${count} ${reason}`).join(', ')}.`, skipped);
  const unsupported = Object.entries(analysis.unsupportedFiles ?? {}), others = unsupported.reduce((sum, [, count]) => sum + count, 0);
  if (others) add('unsupportedFiles', 'inventory', `Files in languages that the analysis does not read: ${unsupported.map(([extension, count]) => `${count} ${extension}`).join(', ')}. No finding covers them.`, others);
  if (analysis.unclassifiedEdges) add('unclassifiedEdges', 'graph', 'Some import edges have no type or value classification.', analysis.unclassifiedEdges);
  const rules = analysis.rules ?? { declared: [], invalid: [] };
  if (!rules.declared.length) add('architectureRules', 'graph', 'No architecture rules are declared in .code-map.json, so no import direction was checked.');
  if (rules.invalid.length) add('invalidRules', 'graph', `These rules are not in the form "from -> to" and were not checked: ${rules.invalid.join('; ')}.`, rules.invalid.length);
  architectureGaps(analysis, add);
  const unrecognized = tests?.testFiles.filter((file) => file.kind === 'unrecognized').length ?? 0;
  if (unrecognized) add('unrecognizedTests', 'inventory', 'Files named as tests have no recognized test case, so the test counts do not include them.', unrecognized);
  if (tests?.unreadable.length) add('unreadableTests', 'inventory', 'Test scripts in other languages are not read, so the test counts do not include them.', tests.unreadable.length);
  if (analysis.packages) packageGaps(analysis.packages, add);
  const safeguardUnknown = analysis.safeguards?.items.filter((item) => item.state === 'UNKNOWN') ?? [];
  if (safeguardUnknown.length) add('safeguardsUnknown', 'pattern', 'Declared safeguards have unsupported or missing syntax. The safeguards section gives each reason.', safeguardUnknown.length);
  const broken = analysis.syntaxErrors ?? [];
  if (broken.length) add('syntaxErrors', 'inventory', 'The parser reports syntax errors in some files. Their imports, exports, declarations and test cases can be incomplete. A finding names each of these files.', broken.length);
  return [...list, ...supplyGaps(analysis.supply)];
}

/** The package checks that did not run or could not decide (lib/packages/): the support report of C01 and C32. */
function packageGaps(packages, add) {
  const named = (paths) => `${paths.slice(0, 3).join(', ')}${paths.length > 3 ? ` and ${paths.length - 3} more` : ''}`;
  const { notInstalled, unused, orphans } = packages.unchecked, skipped = Object.entries(packages.skipped).filter(([, count]) => count);
  if (packages.unreadable.length) add('packageManifestsUnreadable', 'graph', `Code-map cannot read these package.json files: ${named(packages.unreadable)}. Their declaration and orphan checks did not run.`, packages.unreadable.length);
  if (notInstalled.length) add('packagesNotInstalled', 'graph', `${notInstalled.length === 1 ? 'This package.json has' : 'These package.json files have'} no node_modules folder on the path to the repository root: ${named(notInstalled)}. `
    + 'Code-map did not check that the declared packages are installed, or that the exports fields export the imported subpaths. Install the packages, and then analyze again.', notInstalled.length);
  if (skipped.length) add('packageImportsUnchecked', 'graph', `Some bare imports were not checked against a package.json: ${skipped.map(([reason, count]) => `${count} ${reason}`).join(', ')}.`,
    skipped.reduce((sum, [, count]) => sum + count, 0));
  if (packages.unknown.unused?.length) add('dependenciesUnknown', 'graph', `Computed package loaders leave dependency use UNKNOWN: ${named(packages.unknown.unused.map((item) => `${item.package} (${named(item.sites.map((site) => `${site.path}:${site.line}`))})`))}. These candidates have no PACKAGE-UNUSED finding.`, packages.unknown.unused.length);
  if (packages.unknown.exports.length) add('packageExportsUnknown', 'graph', 'Some imports name a package whose exports field has a form that Code-map cannot evaluate, so their subpaths were not checked.', packages.unknown.exports.length);
  if (packages.unknown.orphans.length) add('orphansUnknown', 'graph', 'Some source files have no importer, but a computed dynamic import, a glob, file-based routing or an entry point in build output can reach them. They have no FILE-ORPHANED finding.', packages.unknown.orphans.length);
  if (orphans) add('orphansUnchecked', 'graph', 'Some source files have no package.json above them, so Code-map did not check whether they are orphaned.', orphans);
  if (unused.length) add('dependenciesUnchecked', 'graph', `No code file that Code-map read is below these package.json files, so their dependencies were not checked for use: ${named(unused)}.`, unused.length);
}
