// The contract report (C20) in the summary, its project lists for `--part`, the findings of the OPENAPI- rules, the
// evidence of one such finding, and the operations that a change removed. Pure: it reads the stored analyses.
// Each identity key holds paths, methods and documented paths, never line numbers. Each text says that it is a static lead.
import { removedOperations } from './openapi.mjs';

const lead = 'This is a static lead from the OpenAPI document and the route files, not a request to a running server.';
const at = (path, line, text) => ({ path, line: line ?? null, text });
const ruleIds = ['OPENAPI-NO-HANDLER', 'OPENAPI-PARAM-NAME', 'OPENAPI-UNDOCUMENTED-METHOD'];
/** The summary shows at most this many removed operations of each kind. */
const removedShown = 20;
const countBy = (list, field) => Object.fromEntries(Object.entries(list.reduce((counts, item) => ({ ...counts, [item[field]]: (counts[item[field]] ?? 0) + 1 }), {})).sort(([a], [b]) => (a < b ? -1 : 1)));
/** ' at /api/users' when the base path gives the operation another URL. */
const atUrl = (url, path) => (url && url !== path ? ` at ${url}` : '');

/** The project lists of the contract report, by part name. They are empty without the report. */
export function openapiParts(analysis) {
  const openapi = analysis.frameworks?.openapi;
  return { 'openapi.documents': openapi?.documents ?? [], 'openapi.operations': openapi?.operations ?? [], 'openapi.handlers': openapi?.handlers ?? [] };
}

/** The removed operations of a comparison, or the reason why Code-map cannot list them. */
function removedView(openapi, comparison) {
  const base = comparison.base.data.analysis.frameworks?.openapi, { state, reasons } = comparison.result;
  if (state !== 'COMPARABLE') return { state, reasons, documented: null, handlers: null };
  if (!base || !openapi) return { state: 'UNKNOWN', reasons: ['no-contract-report'], documented: null, handlers: null };
  const { documented, handlers } = removedOperations(base, openapi);
  return { state, reasons, documented: { total: documented.length, items: documented.slice(0, removedShown) }, handlers: { total: handlers.length, items: handlers.slice(0, removedShown) } };
}

/** The counts of the contract report and the command for each list. With a comparison, also the operations that the change removed. */
export function openapiSummary(analysis, partCommand, comparison = null) {
  const openapi = analysis.frameworks?.openapi, removed = comparison ? { removed: removedView(openapi, comparison) } : {};
  if (!openapi) return { detected: null, rules: [], text: 'This stored analysis has no contract report. Run code-map inspect --summary again for a new analysis.', ...removed };
  if (!openapi.documents.length) {
    return { detected: false, rules: [], text: 'No file in the snapshot is named openapi.json, swagger.json or *.openapi.json, or the same names with .yaml or .yml, so no contract rule applied.', ...removed };
  }
  return { detected: true, documents: { total: openapi.documents.length, byState: countBy(openapi.documents, 'state'), next: partCommand('openapi.documents') },
    operations: { total: openapi.operations.length, byState: countBy(openapi.operations, 'state'), next: partCommand('openapi.operations') },
    handlers: { total: openapi.handlers.length, byState: countBy(openapi.handlers, 'state'), next: partCommand('openapi.handlers') },
    rules: ruleIds,
    text: 'Code-map read the OpenAPI documents in JSON and compared each operation (method and path) with the Next.js route handlers of the root that holds the document. '
      + 'It did not read YAML documents or next.config, and it sent no request. The findings are static leads.', ...removed };
}

/** Adds the findings of the OPENAPI- rules to a findings list. `add` is the `add(ruleId, key, finding)` of deriveFindings. */
export function openapiFindings(analysis, add) {
  const openapi = analysis.frameworks?.openapi;
  if (!openapi) return;
  for (const item of openapi.leads.noHandler) {
    const why = item.route ? `The route ${item.route} handles ${item.url}, but it does not export ${item.method}, so Next.js answers 405 Method Not Allowed.`
      : `But no route handler of the Next.js root ${item.root} matches ${item.url}.`;
    add('OPENAPI-NO-HANDLER', [item.document, item.method, item.path], {
      text: `${item.document} documents ${item.method} ${item.path}${atUrl(item.url, item.path)}. ${why} A rewrite, the middleware or a basePath in next.config can explain it. ${lead}`,
      location: { path: item.document, line: item.line, symbol: `${item.method} ${item.path}` }, paths: [item.document, ...(item.route ? [item.route] : [])],
      evidence: [at(item.document, item.line, `documents ${item.method} ${item.path}`), ...(item.route ? [at(item.route, null, `handles ${item.url}`)] : [])],
      facts: { method: item.method, path: item.path, url: item.url, route: item.route, reason: item.reason } });
  }
  for (const item of openapi.leads.paramName) {
    const names = item.pairs.map((pair) => `{${pair.document}} in the document and [${pair.route}] in the route`).join(', ');
    add('OPENAPI-PARAM-NAME', [item.document, item.path, item.route], {
      text: `${item.document} documents ${item.path}, and the route ${item.route} handles it. But the path parameters have other names: ${names}. A client or a generated type that follows the document uses other names than the handler. ${lead}`,
      location: { path: item.document, line: item.line, symbol: item.path }, paths: [item.document, item.route],
      evidence: [at(item.document, item.line, `documents ${item.path}`), at(item.route, null, `handles ${item.routeUrl}`)], facts: { path: item.path, route: item.route, pairs: item.pairs } });
  }
  for (const item of openapi.leads.undocumented) add('OPENAPI-UNDOCUMENTED-METHOD', [item.path, item.method], {
    text: `${item.path} exports the handler ${item.method} for ${item.url}, but no OpenAPI document of its Next.js root (${item.documents.join(', ')}) describes ${item.method} for this route. ${lead}`,
    location: { path: item.path, line: item.line, symbol: item.method }, paths: [item.path, ...item.documents],
    evidence: [at(item.path, item.line, `exports ${item.method}`), ...item.documents.slice(0, 2).map((path) => at(path, null, `describes no ${item.method} ${item.url}`))], facts: { method: item.method, url: item.url } });
}

/** The evidence of one OPENAPI- finding: its lead, its document and its route, with the documented operations of that route. */
export function openapiFindingDetails(analysis, finding, fileCommand) {
  const openapi = analysis.frameworks.openapi, { facts } = finding, path = finding.location.path;
  const lists = { 'OPENAPI-NO-HANDLER': openapi.leads.noHandler, 'OPENAPI-PARAM-NAME': openapi.leads.paramName, 'OPENAPI-UNDOCUMENTED-METHOD': openapi.leads.undocumented };
  const found = lists[finding.ruleId].find((item) => finding.ruleId === 'OPENAPI-UNDOCUMENTED-METHOD' ? item.path === path && item.method === facts.method
    : item.document === path && item.path === facts.path && (facts.method === undefined || item.method === facts.method) && (facts.route === undefined || facts.route === null || item.route === facts.route)) ?? null;
  const route = finding.ruleId === 'OPENAPI-UNDOCUMENTED-METHOD' ? path : facts.route ?? null;
  return { details: { lead: found, route: route ? analysis.frameworks.nextjs.routes.find((item) => item.path === route) ?? null : null,
    operations: route ? openapi.operations.filter((item) => item.route === route) : [], ...(route ? { file: fileCommand(route) } : {}),
    note: 'Code-map compares the method and the path of each operation. It does not compare request bodies, responses or query parameters.' }, parts: {} };
}
