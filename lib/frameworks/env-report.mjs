// The environment report (C26) in the summary, its project lists for `--part`, the findings of the ENV- rules and the
// evidence of one such finding. Pure: it reads the stored analysis. Each identity key holds paths and names, never lines.
import { envTemplates } from './env.mjs';

const lead = 'This is a static lead from the source and the template names, not a run of the code.';
const at = (path, line, text) => ({ path, line: line ?? null, text });
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const ruleIds = ['ENV-UNDECLARED', 'ENV-UNUSED'];

/** The project lists of the environment report, by part name. They are empty without the report. */
export function envParts(analysis) {
  const env = analysis.frameworks?.env;
  return { 'env.names': env?.names ?? [], 'env.reads': env?.reads ?? [], 'env.templates': env?.templates ?? [] };
}

/** The counts of the environment report, and the command for each list. */
export function envSummary(analysis, partCommand) {
  const env = analysis.frameworks?.env;
  if (!env) return { detected: null, rules: [], text: 'This stored analysis has no environment report. Run code-map inspect --summary again for a new analysis.' };
  if (!env.reads.length && !env.templates.length) return { detected: false, rules: [], text: 'No mapped source or test file reads an environment variable, and no package has a template file, so no environment rule applied.' };
  const named = env.reads.filter((read) => read.name !== null).length;
  return { detected: true,
    templates: { total: env.templates.length, read: env.templates.filter((item) => item.state === 'read').length, names: env.templates.reduce((sum, item) => sum + item.names.length, 0), next: partCommand('env.templates') },
    reads: { total: env.reads.length, named, dynamic: env.reads.length - named, files: new Set(env.reads.map((read) => read.path)).size, next: partCommand('env.reads') },
    names: { total: env.names.length, platform: env.names.filter((item) => item.platform).length, next: partCommand('env.names') },
    rules: ruleIds,
    text: `Code-map read process.env and import.meta.env in the mapped source and test files. It read only the names in the template files ${envTemplates.slice(0, -1).join(', ')} and ${envTemplates.at(-1)} at the root of each package. `
      + 'It never reads .env or another file that can hold secret values, and it keeps no value. Platform names such as NODE_ENV, CI and VERCEL_URL are not leads. The findings are static leads.' };
}

/** Adds the findings of the ENV- rules to a findings list. `add` is the `add(ruleId, key, finding)` of deriveFindings. */
export function envFindings(analysis, add) {
  const env = analysis.frameworks?.env;
  if (!env) return;
  for (const item of env.leads.undeclared) add('ENV-UNDECLARED', [item.path, item.name], {
    text: `${item.path} reads the environment variable ${item.name}, but no template file of its package (${item.templates.join(', ')}) declares it. `
      + `Add the name to the template, or check the spelling. A variable that only the deployment sets can explain it. ${lead}`,
    location: { path: item.path, line: item.lines[0] ?? null, symbol: item.name }, paths: [item.path, ...item.templates],
    evidence: [...item.lines.slice(0, 2).map((line) => at(item.path, line, `reads ${item.name}`)), at(item.templates[0], null, `declares no ${item.name}`)],
    facts: { name: item.name, package: item.package } });
  for (const item of env.leads.unused) add('ENV-UNUSED', [item.path, item.name], {
    text: `${item.path} declares ${item.name}, but no mapped source or test file reads it by this name. `
      + `${item.dynamic ? `${plural(item.dynamic, 'read')} with a computed name in the package can read it. ` : ''}A file outside the source roots, such as next.config or a script, can also read it. ${lead}`,
    location: { path: item.path, line: item.line, symbol: item.name }, paths: [item.path], evidence: [at(item.path, item.line, `declares ${item.name}`)],
    facts: { name: item.name, package: item.package, dynamic: item.dynamic } });
}

/** The evidence of one ENV- finding: its lead and the inventory entry of its name. */
export function envFindingDetails(env, finding, fileCommand) {
  const { path } = finding.location, name = finding.facts.name;
  const list = finding.ruleId === 'ENV-UNDECLARED' ? env.leads.undeclared : env.leads.unused;
  return { details: { lead: list.find((item) => item.path === path && item.name === name) ?? null, name: env.names.find((item) => item.name === name) ?? null,
    ...(finding.ruleId === 'ENV-UNDECLARED' ? { file: fileCommand(path) } : {}),
    note: 'Code-map reads the names of the template files, never their values. A read with a computed name has no name, so no rule can check it.' }, parts: {} };
}
