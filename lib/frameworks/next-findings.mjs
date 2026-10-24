// The findings of the Next.js rules (C26), from the leads of the framework report, and the evidence of one such finding.
// Each identity key holds paths and names, never line numbers. Each text says that the finding is a static lead.
const at = (path, line, text) => ({ path, line: line ?? null, text });
const graphLead = 'This is a static lead from the import graph and the source, not a result of a Next.js build.';
const sourceLead = 'This is a static lead from the source, not a result of a Next.js build.';
const plural = (list, one, many = one + 's') => (list.length === 1 ? one : many);
const words = (list) => (list.length > 1 ? `${list.slice(0, -1).join(', ')} and ${list.at(-1)}` : list[0]);
const imports = {
  'server-only': () => 'It imports "server-only", which marks server code. Next.js stops the build when client code imports it.',
  'next-headers': () => 'It imports "next/headers", which works only on the server. Next.js stops the build when client code imports it.',
  'next-server': () => 'It imports "next/server", which holds the APIs of middleware and route handlers. They do not work in the browser.',
  'node-builtin': (module) => `It imports the Node.js built-in module "${module}". The browser does not have it, so Next.js stops the build or bundles a replacement.`,
  'imports-server-only': (module) => `It imports ${module}, which imports "server-only". Next.js stops the build when client code imports such a module.`,
};
const exportKinds = { function: 'a function that is not async', class: 'a class', enum: 'an enum', value: 'a value, not a function' };

/** Why the framework report put a module on its side. */
function why(module, routes) {
  if (module.reason === 'use-client') return "it has the directive 'use client'";
  if (module.reason === 'use-server') return "it has the directive 'use server'";
  if (module.reason === 'route') {
    const route = routes.find((item) => item.path === module.path);
    return route?.kind === 'middleware' ? 'it is the Next.js middleware' : `it is an App Router ${route?.kind ?? 'route'} file without 'use client'`;
  }
  return module.side === 'server' ? `${module.entry} reaches it through imports without a 'use client' boundary`
    : `it is reached from the client module ${module.entry}, and no server entry reaches it`;
}

/** Adds the findings of the Next.js rules to a findings list. `add` is the `add(ruleId, key, finding)` of deriveFindings. */
export function nextFindings(analysis, add) {
  const nextjs = analysis.frameworks?.nextjs;
  if (!nextjs?.detected) return;
  const classes = new Map(nextjs.modules.map((item) => [item.path, item])), files = new Map(analysis.files.map((file) => [file.path, file]));
  const importer = (module) => {
    if (!module.via) return [];
    const edge = files.get(module.via)?.imports.find((item) => item.target === module.path);
    return [at(module.via, edge?.line, `imports ${module.path}`)];
  };
  const finding = (path, evidence, text, facts, paths = [path]) => {
    const module = classes.get(path);
    return { location: { path, line: evidence[0]?.line ?? null, symbol: facts.name ?? null }, paths, evidence: [...evidence.slice(0, module?.via ? 2 : 3), ...importer(module ?? {})].slice(0, 3),
      text: text(module ? why(module, nextjs.routes) : 'the framework report classified it'), facts: { ...facts, reason: module?.reason ?? null, entry: module?.entry ?? null } };
  };
  for (const lead of nextjs.leads.clientApiInServer) {
    const hooks = [...new Set(lead.hooks.map((hook) => hook.name))], handlers = [...new Set(lead.handlers.map((handler) => handler.name))];
    const uses = [...(hooks.length ? [`calls the React client ${plural(hooks, 'hook')} ${words(hooks)}`] : []),
      ...(handlers.length ? [`sets the event ${plural(handlers, 'handler')} ${words(lead.handlers.map((handler) => `${handler.name} on <${handler.element}>`).filter((text, index, list) => list.indexOf(text) === index))}`] : [])];
    const evidence = [...lead.hooks.map((hook) => at(lead.path, hook.line, `calls ${hook.name}`)), ...lead.handlers.map((handler) => at(lead.path, handler.line, `sets ${handler.name} on <${handler.element}>`))]
      .sort((a, b) => a.line - b.line);
    add('NEXT-CLIENT-API-IN-SERVER', [lead.path], finding(lead.path, evidence, (reason) => `${lead.path} is a server module: ${reason}. It ${uses.join(' and ')}. `
      + `Next.js allows client hooks and event handlers only in client modules. ${graphLead}`, { hooks, handlers }));
  }
  for (const lead of nextjs.leads.serverImportInClient) {
    const evidence = lead.lines.map((line) => at(lead.path, line, `imports ${lead.module}`));
    add('NEXT-SERVER-IMPORT-IN-CLIENT', [lead.path, lead.kind, lead.module], finding(lead.path, evidence.length ? evidence : [at(lead.path, null, `imports ${lead.module}`)],
      (reason) => `${lead.path} is client code: ${reason}. ${imports[lead.kind](lead.module)} ${graphLead}`, { kind: lead.kind, module: lead.module },
      lead.kind === 'imports-server-only' ? [lead.path, lead.module] : [lead.path]));
  }
  for (const lead of nextjs.leads.serverActionExports) {
    add('NEXT-USE-SERVER-EXPORT', [lead.path, lead.name], finding(lead.path, [at(lead.path, lead.line, `exports ${lead.name}`)],
      () => `${lead.path} has the directive 'use server' and exports ${lead.name}, which is ${exportKinds[lead.kind]}. Next.js allows only async functions as the exports of a 'use server' file. ${sourceLead}`,
      { name: lead.name, kind: lead.kind }));
  }
  for (const lead of nextjs.leads.clientPrivateEnv) {
    add('NEXT-CLIENT-PRIVATE-ENV', [lead.path, lead.name], finding(lead.path, lead.lines.map((line) => at(lead.path, line, `reads process.env.${lead.name}`)),
      (reason) => `${lead.path} is client code: ${reason}. It reads process.env.${lead.name}. Next.js puts only NODE_ENV and the variables that start with NEXT_PUBLIC_ into the browser bundle. `
        + `In the browser the value is undefined, and the variable name is visible in client code. An env value in next.config can explain it. ${graphLead}`, { name: lead.name }));
  }
}

/** The evidence of one Next.js finding: its lead, the class of its module and the import chain from the entry that reached it. */
export function nextFindingDetails(nextjs, finding, fileCommand) {
  const { path } = finding.location, facts = finding.facts, classes = new Map(nextjs.modules.map((item) => [item.path, item]));
  const lists = { 'NEXT-CLIENT-API-IN-SERVER': nextjs.leads.clientApiInServer, 'NEXT-SERVER-IMPORT-IN-CLIENT': nextjs.leads.serverImportInClient,
    'NEXT-USE-SERVER-EXPORT': nextjs.leads.serverActionExports, 'NEXT-CLIENT-PRIVATE-ENV': nextjs.leads.clientPrivateEnv };
  const lead = (lists[finding.ruleId] ?? []).find((item) => item.path === path && (facts.name === undefined || item.name === facts.name)
    && (facts.kind === undefined || finding.ruleId === 'NEXT-USE-SERVER-EXPORT' || (item.kind === facts.kind && item.module === facts.module))) ?? null;
  const chain = [];
  for (let current = classes.get(path); current && chain.length <= classes.size; current = current.via ? classes.get(current.via) : null) chain.unshift(current.path);
  const target = finding.ruleId === 'NEXT-SERVER-IMPORT-IN-CLIENT' && facts.kind === 'imports-server-only' ? fileCommand(facts.module) : null;
  return { details: { lead, module: classes.get(path) ?? null, chain, file: fileCommand(path), ...(target ? { target } : {}),
    note: 'The chain starts at the entry that reached the module first. Other import paths to the module can exist.' }, parts: {} };
}
