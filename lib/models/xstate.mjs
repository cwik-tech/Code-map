// XState machines in a source file (C23): `createMachine({...})` and `setup({...}).createMachine({...})` calls in a file that
// imports createMachine or setup from xstate. Code-map reads `id`, `initial`, `type` and `states`, the `on` events, and the
// eventless `always`, `after`, `onDone` and `invoke` transitions. A part that is not a literal is UNKNOWN for that part.
// Targets resolve as in XState 5: `x` is a sibling, `.x` a child, `#id.x` a state by its ID. Syntax only: no source runs.
import ts from 'typescript';

const lineOf = (source, node) => source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
const keyOf = (name) => (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name) || ts.isNoSubstitutionTemplateLiteral(name) ? name.text : null);
const join = (path, key) => (path ? `${path}.${key}` : key);
/** XState gives a machine without an id this id. */
const defaultId = '(machine)';

/** The local names of createMachine and setup, and of a namespace import of xstate. */
function xstateNames(source) {
  const names = { createMachine: new Set(), setup: new Set(), namespaces: new Set() };
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier) || statement.moduleSpecifier.text !== 'xstate') continue;
    const bindings = statement.importClause?.isTypeOnly ? null : statement.importClause?.namedBindings;
    if (bindings && ts.isNamespaceImport(bindings)) names.namespaces.add(bindings.name.text);
    else if (bindings) for (const element of bindings.elements) {
      const imported = (element.propertyName ?? element.name).text;
      if (!element.isTypeOnly && (imported === 'createMachine' || imported === 'setup')) names[imported].add(element.name.text);
    }
  }
  return names;
}

/** A call of `name` from xstate: `name(...)` with the imported name, or `xstate.name(...)` through a namespace import. */
const callsOf = (callee, names, name) => (ts.isIdentifier(callee) ? names[name].has(callee.text)
  : ts.isPropertyAccessExpression(callee) && callee.name.text === name && ts.isIdentifier(callee.expression) && names.namespaces.has(callee.expression.text));

function isMachineCall(node, names) {
  if (!ts.isCallExpression(node)) return false;
  const callee = node.expression;
  return callsOf(callee, names, 'createMachine') || (ts.isPropertyAccessExpression(callee) && callee.name.text === 'createMachine'
    && ts.isCallExpression(callee.expression) && callsOf(callee.expression.expression, names, 'setup'));
}

/** The XState machines of a parsed source file, in the order of the source. */
export function xstateMachines(source) {
  const names = xstateNames(source), machines = [];
  if (!names.createMachine.size && !names.setup.size && !names.namespaces.size) return machines;
  const visit = (node) => {
    if (isMachineCall(node, names)) machines.push(readMachine(source, node));
    ts.forEachChild(node, visit);
  };
  visit(source);
  return machines;
}

/** One machine: its states as nodes with paths (the root is ''), its transitions with resolved targets, and its UNKNOWN parts. */
function readMachine(source, call) {
  const variable = ts.isVariableDeclaration(call.parent) && ts.isIdentifier(call.parent.name) ? call.parent.name.text : null;
  const machine = { variable, id: null, line: lineOf(source, call), initial: null, nodes: [], transitions: [], unknown: [] };
  const config = call.arguments[0], raw = [], ids = new Map();
  if (!config || !ts.isObjectLiteralExpression(config)) {
    machine.nodes.push({ path: '', parent: null, type: 'atomic', initial: null, children: [], line: machine.line });
    machine.unknown.push({ state: '', part: 'config', event: null, reason: 'not-literal', line: machine.line });
    return machine;
  }
  readNode(source, config, '', null, machine.line, { machine, raw, ids });
  machine.id = [...ids].find(([, path]) => path === '')?.[0] ?? null;
  if (machine.id === null) ids.set(defaultId, '');
  const nodes = new Map(machine.nodes.map((node) => [node.path, node])), hiddenIds = machine.unknown.some((item) => item.part === 'id');
  const descend = (base, relative) => {
    let path = base;
    for (const key of relative.split('.')) { path = join(path, key); if (!nodes.has(path)) return null; }
    return path;
  };
  const resolve = (from, target) => {
    if (target.startsWith('#')) {
      const rest = target.slice(1);
      if (ids.has(rest)) return ids.get(rest);
      for (const [id, path] of ids) if (rest.startsWith(`${id}.`)) { const found = descend(path, rest.slice(id.length + 1)); if (found !== null) return found; }
      return null;
    }
    if (target.startsWith('.')) return descend(from, target.slice(1));
    const parent = nodes.get(from).parent;
    return parent === null ? null : descend(parent, target);
  };
  for (const { from, event, kind, targets, line } of raw) {
    const to = targets === null ? null : [];
    for (const target of targets ?? []) {
      const found = resolve(from, target);
      if (found !== null) to.push(found);
      else machine.unknown.push({ state: from, part: 'target', event, reason: target.startsWith('#') && hiddenIds ? 'not-literal' : 'target-not-found', line });
    }
    machine.transitions.push({ from, event, kind, to, line });
  }
  for (const node of machine.nodes) {
    if (node.initial === null) continue;
    if (nodes.has(join(node.path, node.initial))) node.initial = join(node.path, node.initial);
    else { machine.unknown.push({ state: node.path, part: 'initial', event: null, reason: 'target-not-found', line: node.line }); node.initial = null; }
  }
  machine.initial = nodes.get('').initial;
  machine.unknown = machine.unknown.map((item, index) => ({ item, index })).sort((a, b) => a.item.line - b.item.line || a.index - b.index).map(({ item }) => item);
  return machine;
}

/** One state node and, depth first, its children. Its transitions are recorded before the transitions of its children. */
function readNode(source, object, path, parent, line, context) {
  const { machine, raw, ids } = context, node = { path, parent, type: 'atomic', initial: null, children: [], line };
  machine.nodes.push(node);
  const unknown = (part, at, event = null, reason = 'not-literal') => machine.unknown.push({ state: path, part, event, reason, line: lineOf(source, at) });
  const props = new Map();
  for (const property of object.properties) {
    const key = ts.isPropertyAssignment(property) || ts.isMethodDeclaration(property) ? keyOf(property.name) : null;
    if (ts.isPropertyAssignment(property) && key !== null) props.set(key, property.initializer);
    else if (!(ts.isMethodDeclaration(property) && key !== null) && !ts.isAccessor(property)) unknown('config', property);
  }
  const text = (key) => {
    const value = props.get(key);
    if (value === undefined) return undefined;
    if (ts.isStringLiteralLike(value)) return value.text;
    unknown(key, value);
    return null;
  };
  const id = text('id'), type = text('type'), initial = text('initial');
  if (typeof id === 'string') ids.set(id, path);
  if (type === 'final' || type === 'parallel') node.type = type;
  if (type === 'history') unknown('type', props.get('type'), null, 'history');
  if (typeof initial === 'string') node.initial = initial;
  /** One transition or a list of guarded alternatives. A config without `target` stays in the state. */
  const transitions = (value, kind, event, at) => {
    for (const item of ts.isArrayLiteralExpression(value) ? value.elements : [value]) {
      const entry = { from: path, event, kind, targets: [], line: lineOf(source, at) };
      raw.push(entry);
      if (ts.isStringLiteralLike(item)) { entry.targets = [item.text]; continue; }
      if (item.kind === ts.SyntaxKind.NullKeyword || (ts.isIdentifier(item) && item.text === 'undefined')) continue;
      const target = ts.isObjectLiteralExpression(item) ? item.properties.find((property) => ts.isPropertyAssignment(property) && keyOf(property.name) === 'target') : null;
      const hidden = ts.isObjectLiteralExpression(item) && item.properties.some((property) => ts.isSpreadAssignment(property) || (ts.isShorthandPropertyAssignment(property) && property.name.text === 'target'));
      const list = target && ts.isArrayLiteralExpression(target.initializer) ? target.initializer.elements : target ? [target.initializer] : [];
      if (!ts.isObjectLiteralExpression(item) || hidden || !list.every((element) => ts.isStringLiteralLike(element))) {
        entry.targets = null;
        unknown('target', target?.initializer ?? item, event);
      } else entry.targets = list.map((element) => element.text);
    }
  };
  const objects = (key, each) => {
    const value = props.get(key);
    if (value === undefined) return;
    for (const item of ts.isArrayLiteralExpression(value) ? value.elements : [value]) {
      if (!ts.isObjectLiteralExpression(item)) { unknown(key, item); continue; }
      for (const property of item.properties) {
        const name = ts.isPropertyAssignment(property) ? keyOf(property.name) : null;
        if (name === null) unknown(key, property); else each(name, property);
      }
    }
  };
  objects('on', (event, property) => transitions(property.initializer, 'event', event, property));
  for (const [key, kind] of [['always', 'always'], ['onDone', 'done']]) if (props.has(key)) transitions(props.get(key), kind, null, props.get(key));
  objects('after', (_, property) => transitions(property.initializer, 'after', null, property));
  objects('invoke', (name, property) => { if (name === 'onDone' || name === 'onError') transitions(property.initializer, 'invoke', null, property); });
  const states = props.get('states');
  if (states !== undefined && !ts.isObjectLiteralExpression(states)) unknown('states', states);
  else if (states !== undefined) for (const property of states.properties) {
    const key = ts.isPropertyAssignment(property) ? keyOf(property.name) : null;
    if (key === null) { unknown('states', property); continue; }
    const child = join(path, key), at = lineOf(source, property);
    node.children.push(child);
    if (ts.isObjectLiteralExpression(property.initializer)) readNode(source, property.initializer, child, path, at, context);
    else {
      machine.nodes.push({ path: child, parent: path, type: 'atomic', initial: null, children: [], line: at });
      machine.unknown.push({ state: child, part: 'config', event: null, reason: 'not-literal', line: lineOf(source, property.initializer) });
    }
  }
  if (node.children.length && node.type === 'atomic') node.type = 'compound';
  if (node.type === 'compound' && initial === undefined) unknown('initial', object, null, 'no-initial');
}
