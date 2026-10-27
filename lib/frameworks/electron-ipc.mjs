// Electron IPC contracts are syntax leads. UNKNOWN endpoints suppress claims that require their absence.
import ts from 'typescript';
import { injectedFunctions } from './electron-ipc-injection.mjs';
import { syntax, walk, unwrap, location } from './electron-ipc-syntax.mjs';

const main = { handle: 'handle', handleOnce: 'handle', on: 'on', once: 'on', removeHandler: 'remove' };
const renderer = { invoke: 'invoke', send: 'send', sendSync: 'send', on: 'listen', once: 'listen' };
const producer = (call) => ['invoke', 'send', 'push'].includes(call.kind);
const overlap = (a, b) => !a || !b || (a.pattern && b.pattern ? a.value.startsWith(b.value) || b.value.startsWith(a.value)
  : a.pattern ? b.value.startsWith(a.value) : b.pattern ? a.value.startsWith(b.value) : a.value === b.value);

function detected(texts) {
  for (const [path, text] of texts) if (/(^|\/)package\.json$/.test(path) && !path.split('/').includes('node_modules')) {
    try { const pkg = JSON.parse(text); if (typeof pkg?.dependencies?.electron === 'string' || typeof pkg?.devDependencies?.electron === 'string') return true; }
    catch { /* An unreadable manifest cannot establish Electron detection. */ }
  }
  return false;
}

export function analyzeElectronIpc({ texts = new Map(), files = [] } = {}) {
  if (!detected(texts)) return null;
  const { sources, checker, symbol, electronName, resolve } = syntax(texts, files), functions = new Map(), nodes = [];
  for (const source of sources) walk(source, (node) => {
    if (ts.isCallExpression(node)) nodes.push(node);
    if (ts.isFunctionLike(node) && node.body) {
      const name = node.name ?? (ts.isVariableDeclaration(node.parent) ? node.parent.name : null);
      if (name) functions.set(symbol(name), node);
    }
  });
  const targetsOf = injectedFunctions({ functions, nodes, symbol, checker });
  const direct = (call) => {
    const expr = call.expression;
    if (!ts.isPropertyAccessExpression(expr)) return null;
    const owner = expr.expression, method = expr.name.text, api = electronName(owner);
    if (api === 'ipcMain' && Object.hasOwn(main, method)) return { kind: main[method], method, direction: 'page-to-main' };
    if (api === 'ipcRenderer' && Object.hasOwn(renderer, method)) return { kind: renderer[method], method, direction: renderer[method] === 'listen' ? 'main-to-page' : 'page-to-main' };
    const text = owner.getText(), type = checker.typeToString(checker.getTypeAtLocation(owner));
    const namedContents = /(^|\.)webContents$/.test(text) || text === 'contents' || /\bWebContents\b/.test(type);
    if ((method === 'send' && (namedContents || /(^|\.)(event|e|evt)\.sender$/.test(text))) || (method === 'reply' && /^(event|e|evt)$/.test(text))) {
      return { kind: 'push', method, direction: 'main-to-page' };
    }
    return null;
  };
  const functionCalls = (fn) => {
    const calls = [];
    const visit = (node) => { if (ts.isFunctionLike(node) && node !== fn) return; if (ts.isCallExpression(node)) calls.push(node); ts.forEachChild(node, visit); };
    visit(fn.body);
    return calls;
  };
  // A wrapper descriptor records which parameter reaches which endpoint. Three function boundaries are the limit.
  const descriptors = (fn, depth = 1, seen = new Set()) => {
    if (depth > 3 || seen.has(fn)) return [];
    const next = new Set(seen).add(fn), params = fn.parameters.map((p) => symbol(p.name)), results = [];
    for (const call of functionCalls(fn)) {
      const endpoint = direct(call);
      const targets = endpoint ? [{ ...endpoint, parameter: 0 }]
        : targetsOf(call.expression).flatMap((target) => descriptors(target.fn, depth + 1 + target.depth, next));
      for (const item of targets) {
        const arg = unwrap(call.arguments[item.parameter]);
        const index = arg && ts.isIdentifier(arg) ? params.indexOf(symbol(arg)) : -1;
        if (index >= 0) results.push({ ...item, parameter: index });
      }
    }
    return results;
  };
  const wrappers = new Map([...functions].map(([sym, fn]) => [sym, descriptors(fn)]).filter(([, list]) => list.length));
  const calls = [];
  for (const node of nodes) {
    const endpoint = direct(node), targets = endpoint ? [{ ...endpoint, parameter: 0 }] : targetsOf(node.expression).flatMap((target) => descriptors(target.fn, 1 + target.depth));
    for (const target of targets) {
      const arg = node.arguments[target.parameter], argSymbol = arg && ts.isIdentifier(unwrap(arg)) ? symbol(unwrap(arg)) : null;
      // Parameter forwarding in a recognized wrapper is represented at the call site, not as an UNKNOWN endpoint.
      let parent = node.parent;
      while (parent && !ts.isFunctionLike(parent)) parent = parent.parent;
      const named = parent?.name ?? (parent && ts.isVariableDeclaration(parent.parent) ? parent.parent.name : null);
      if (named && wrappers.has(symbol(named)) && parent.parameters.some((p) => symbol(p.name) === argSymbol)) continue;
      calls.push({ ...location(node), ...target, channel: resolve(arg), wrapper: endpoint ? null : node.expression.getText() });
    }
  }
  const active = calls.filter((x) => x.kind !== 'remove'), known = active.filter((x) => x.channel), unknownChannels = active.filter((x) => !x.channel);
  const channels = [...new Map(known.map((x) => [JSON.stringify(x.channel), x.channel])).values()].sort((a, b) => a.value.localeCompare(b.value)).map((channel) => ({
    channel: channel.value, pattern: channel.pattern, producers: known.filter((x) => overlap(channel, x.channel) && producer(x)), consumers: known.filter((x) => overlap(channel, x.channel) && !producer(x)),
  }));
  const leads = [];
  for (const call of known) {
    const others = active.filter((x) => x.direction === call.direction && overlap(x.channel, call.channel));
    const has = (kinds) => others.some((x) => kinds.includes(x.kind));
    let ruleId = null;
    if (['invoke', 'send'].includes(call.kind)) {
      const expected = call.kind === 'invoke' ? 'handle' : 'on';
      if (!has([expected])) {
        if (others.some((x) => x.channel && ['handle', 'on'].includes(x.kind))) ruleId = 'ELECTRON-IPC-KIND-MISMATCH';
        else if (!has(['handle', 'on'])) ruleId = 'ELECTRON-IPC-NO-HANDLER';
      }
    } else if (call.kind === 'push' && !has(['listen'])) ruleId = 'ELECTRON-IPC-NO-LISTENER';
    else if (['handle', 'on'].includes(call.kind) && !has(['invoke', 'send'])) ruleId = 'ELECTRON-IPC-UNUSED-HANDLER';
    if (ruleId) leads.push({ ruleId, path: call.path, line: call.line, channel: call.channel.value, pattern: call.channel.pattern, kind: call.kind, direction: call.direction });
  }
  return { detected: true, channels, calls, wrappers: [...wrappers.keys()].map((sym) => ({ name: sym.name, ...location(functions.get(sym)) })), unknownChannels, leads };
}
