// The framework support report (C40) that the summary shows, and the project lists that `--part` pages through.
// Pure: it reads the stored analysis. `partCommand(part)` prints the command for the first page of one list.
import { findingRules } from '../findings.mjs';

const nextRules = () => Object.keys(findingRules).filter((ruleId) => ruleId.startsWith('NEXT-'));
const surfaces = [
  ['app-router', 'checked', "Routes and URL patterns of the App Router, the HTTP methods that each route file exports, and its client and server modules from the 'use client' directives and the import graph."],
  ['pages-router', 'partial', 'Routes and URL patterns only. The Pages Router has no client boundary, so Code-map does not classify its modules. An API route handles every method, so its methods are UNKNOWN.'],
  ['middleware', 'partial', 'Middleware files in a Next.js root or in its src folder. Code-map counts them as server entries.'],
  ['proxy', 'partial', 'Proxy files in a Next.js root or in its src folder. Code-map counts them as server entries.'],
  ['server-actions', 'checked', "Files with the directive 'use server': each export must be an async function. Inline 'use server' functions, re-exports and values from calls are not checked."],
  ['environment', 'checked', 'process.env reads with a literal name in client modules. Destructured and computed reads are not checked.'],
  ['next-config', 'not-checked', 'Code-map does not read next.config: custom page extensions, env values, rewrites and redirects are not checked.'],
].map(([key, state, text]) => ({ key, state, text }));

/** The counts of the values of one field, with the keys in order. */
const countBy = (list, field) => Object.fromEntries(Object.entries(list.reduce((counts, item) => ({ ...counts, [item[field]]: (counts[item[field]] ?? 0) + 1 }), {})).sort(([a], [b]) => (a < b ? -1 : 1)));

/** The project lists of the framework report, by part name. They are empty without Next.js. */
export function frameworkParts(analysis) {
  const nextjs = analysis.frameworks?.nextjs;
  return { 'nextjs.routes': nextjs?.routes ?? [], 'nextjs.modules': nextjs?.modules ?? [], 'nextjs.unclassified': nextjs?.unclassified ?? [] };
}

/** Which framework surfaces Code-map checked, how many modules it classified, and what it cannot classify. */
export function frameworkSummary(analysis, partCommand) {
  const nextjs = analysis.frameworks?.nextjs;
  if (!nextjs) return { nextjs: { detected: null, packages: [], rules: [], text: 'This stored analysis has no framework report. Run code-map inspect --summary again for a new analysis.' } };
  const unreadable = nextjs.unreadable.length ? { unreadablePackages: nextjs.unreadable.length } : {};
  const bad = nextjs.unreadable.length;
  const unread = bad ? ` ${bad} package.json ${bad === 1 ? 'file is not valid JSON, so Code-map cannot tell whether it lists' : 'files are not valid JSON, so Code-map cannot tell whether they list'} next.` : '';
  if (!nextjs.detected) return { nextjs: { detected: false, packages: [], ...unreadable, rules: [], text: `No package.json in the snapshot lists next in dependencies or devDependencies, so no Next.js rule applied.${unread}` } };
  const side = (name) => nextjs.modules.filter((item) => item.side === name).length;
  return { nextjs: { detected: true, packages: nextjs.packages, ...unreadable, surfaces,
    routes: { total: nextjs.routes.length, byRouter: countBy(nextjs.routes, 'router'), byKind: countBy(nextjs.routes, 'kind'), next: partCommand('nextjs.routes') },
    modules: { client: side('client'), server: side('server'), next: partCommand('nextjs.modules') },
    unclassified: { total: nextjs.unclassified.length, byReason: countBy(nextjs.unclassified, 'reason'), next: partCommand('nextjs.unclassified') },
    rules: nextRules(),
    text: `Code-map read the directives, the imports and the source of the mapped files, and ran no Next.js build. The client and server classes and the findings are static leads.${unread}` } };
}
