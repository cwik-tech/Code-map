// The findings of the package rules (C01 and C32), from the leads of the package report, and the evidence of one such finding.
// Each identity key holds paths and names, never line numbers. Each text says that the finding is a static lead and why it
// can be wrong.
import { posix } from 'node:path';

const at = (path, line, text) => ({ path, line: line ?? null, text });
const quoted = (list) => list.map((item) => `"${item}"`).join(', ');
const lines = (lead, text) => (lead.lines.length ? lead.lines : [null]).slice(0, 3).map((line) => at(lead.path, line, text));
const fields = 'dependencies, devDependencies, peerDependencies or optionalDependencies';

/** The rule of each list of leads. */
export const packageRules = { undeclared: 'PACKAGE-UNDECLARED', unresolved: 'PACKAGE-UNRESOLVED', notExported: 'PACKAGE-SUBPATH-NOT-EXPORTED', devOnly: 'PACKAGE-DEV-ONLY',
  orphaned: 'FILE-ORPHANED', unused: 'PACKAGE-UNUSED' };

/** Adds the findings of the package rules to a findings list. `add` is the `add(ruleId, key, finding)` of deriveFindings. */
export function packageFindings(analysis, add) {
  const leads = analysis.packages?.leads;
  if (!leads) return;
  const file = (lead, facts) => ({ location: { path: lead.path, line: lead.lines?.[0] ?? null, symbol: facts.package ?? null }, paths: [lead.path], facts });
  for (const lead of leads.undeclared) {
    const above = lead.declaredBy ? ` Only ${lead.declaredBy} above it declares the package. A user who installs the package of ${lead.manifest} does not get it.` : '';
    add('PACKAGE-UNDECLARED', [lead.path, lead.package], { ...file(lead, { package: lead.package, specifiers: lead.specifiers, manifest: lead.manifest, typeOnly: lead.typeOnly, test: lead.test, declaredBy: lead.declaredBy }),
      evidence: lines(lead, `imports ${lead.package}`),
      text: `${lead.path} imports ${quoted(lead.specifiers)}, but ${lead.manifest} does not declare ${lead.package} in ${fields}.${above} This is a static lead from the import and the package.json. `
        + 'The import can still work through a package that another package installs, an alias that Code-map does not read, or a global install.' });
  }
  for (const lead of leads.devOnly) {
    add('PACKAGE-DEV-ONLY', [lead.path, lead.package], { ...file(lead, { package: lead.package, specifiers: lead.specifiers, manifest: lead.manifest, declaredBy: lead.declaredBy }),
      evidence: lines(lead, `imports ${lead.package}`),
      text: `${lead.path} is a production file and imports ${quoted(lead.specifiers)} but ${lead.declaredBy} declares ${lead.package} only in devDependencies. `
        + 'An install without devDependencies does not get it. This is a static lead. The file can run only during development, or a bundler can include the package.' });
  }
  for (const lead of leads.unresolved) {
    add('PACKAGE-UNRESOLVED', [lead.path, lead.package], { ...file(lead, { package: lead.package, specifiers: lead.specifiers, manifest: lead.manifest, declaredBy: lead.declaredBy, fields: lead.fields }),
      evidence: lines(lead, `imports ${lead.package}`),
      text: `${lead.path} imports ${quoted(lead.specifiers)}. ${lead.declaredBy} declares ${lead.package}, but no node_modules folder from ${posix.dirname(lead.path)} up to the repository root has a folder for it. `
        + 'This is a static lead from the import and the installed folders. An install that is not complete, or a package manager that keeps packages in another place, can give it.' });
  }
  for (const lead of leads.notExported) {
    add('PACKAGE-SUBPATH-NOT-EXPORTED', [lead.path, lead.specifier], { ...file(lead, { package: lead.package, specifier: lead.specifier, subpath: lead.subpath, folder: lead.folder, manifest: lead.manifest }),
      evidence: lines(lead, `imports ${lead.specifier}`),
      text: `${lead.path} imports "${lead.specifier}", but the exports field of ${lead.folder}/package.json does not export the subpath "${lead.subpath}". Node.js and the bundlers that read the exports field refuse the import. `
        + 'This is a static lead from the installed package.json. A tool that ignores the exports field, or another installed version of the package, can still load it.' });
  }
  for (const lead of leads.unused) {
    add('PACKAGE-UNUSED', [lead.manifest, lead.package], { location: { path: lead.manifest, line: lead.line, symbol: lead.package }, paths: [lead.manifest],
      facts: { package: lead.package, manifest: lead.manifest }, evidence: [at(lead.manifest, lead.line, `dependencies: ${lead.package}`)],
      text: `${lead.manifest} declares ${lead.package} in dependencies, but no code or style file below ${posix.dirname(lead.manifest)} imports it. No script or config file at the package root names it. `
        + 'This is a static lead, because a package can work without an import. Examples are a command, a plugin with another name in a config file, a peer of a framework and a computed style import.' });
  }
  for (const lead of leads.orphaned) {
    add('FILE-ORPHANED', [lead.path], { location: { path: lead.path, line: null, symbol: null }, paths: [lead.path], facts: { manifest: lead.manifest },
      evidence: [at(lead.path, null, 'no importer'), at(lead.manifest, null, 'names no entry point for it')],
      text: `${lead.path} has no importer in the snapshot, and it is not an entry point that Code-map knows. This is a static lead from the import graph. `
        + 'A loader, a file-based router, a tool configuration or code outside the repository can still use the file.' });
  }
}

const notes = {
  'PACKAGE-UNDECLARED': 'Code-map reads only the dependency fields of the nearest package.json, including for private packages and test files.',
  'PACKAGE-DEV-ONLY': 'Type-only imports and Electron runtime imports do not count. Test files, config files, stories and scripts are development files.',
  'PACKAGE-UNRESOLVED': 'Code-map looks for the folder of the package in each node_modules folder from the folder of the file up to the repository root. It does not look above the repository.',
  'PACKAGE-SUBPATH-NOT-EXPORTED': 'Code-map reads only the exports field of the installed package.json. A subpath is exported when one condition of its target has a value.',
  'PACKAGE-UNUSED': 'Code-map looks for the package in the imports of the code and style files below the package folder. It also looks in the scripts and the other fields of the package.json, and in the config files at the package root.',
  'FILE-ORPHANED': 'An entry point is a file that a package.json field, a script or a config file names. Config files, stories, files in a scripts or bin folder and Next.js routes are entry points too.',
};

/**
 * The evidence of one package finding: its lead, the package.json of the lead and a command for the file. The command is null
 * for a file that is not a mapped source file, such as a test file, because `--file` accepts only source files.
 */
export function packageFindingDetails(analysis, finding, fileCommand) {
  const { path, symbol } = finding.location, facts = finding.facts, packages = analysis.packages;
  const list = packages.leads[Object.keys(packageRules).find((kind) => packageRules[kind] === finding.ruleId)] ?? [];
  const lead = list.find((item) => finding.ruleId === 'PACKAGE-UNUSED' ? item.manifest === path && item.package === symbol
    : item.path === path && (facts.specifier === undefined || item.specifier === facts.specifier) && (facts.package === undefined || item.package === facts.package)) ?? null;
  const manifestPath = facts.manifest ?? null, manifest = packages.manifests.find((item) => item.path === manifestPath) ?? null;
  const file = analysis.files.some((item) => item.path === path) ? fileCommand(path) : null;
  return { details: { lead, manifest, ...(finding.ruleId === 'PACKAGE-UNUSED' ? {} : { file }), note: notes[finding.ruleId] }, parts: {} };
}
