"""Syntax-only failure paths and bounded symbolic test operands."""
import ast
from functools import lru_cache

NAME = None
FUNCTIONS = common.FUNCTIONS
DEFINITIONS = common.DEFINITIONS


def walk(nodes):
    pending = list(reversed(list(nodes)))
    while pending:
        node = pending.pop()
        yield node
        if not isinstance(node, DEFINITIONS):
            pending.extend(reversed(common.children(node)))


def bindings_in(nodes, inherited):
    bindings = dict(inherited)
    for node in nodes:
        if isinstance(node, ast.Import):
            for alias in node.names:
                bindings[alias.asname or alias.name.split('.')[0]] = {
                    'module': alias.name if alias.asname else alias.name.split('.')[0],
                    'level': 0, 'imported': '*'}
        elif isinstance(node, ast.Name) and isinstance(node.ctx, (ast.Store, ast.Del)):
            bindings.pop(node.id, None)
        elif isinstance(node, ast.ImportFrom):
            for alias in node.names:
                if alias.name != '*':
                    bindings[alias.asname or alias.name] = {
                        'module': node.module or '', 'level': node.level, 'imported': alias.name}
    return bindings


def extract(tree, text, path):
    module_nodes = list(walk(tree.body))
    module_bindings = bindings_in(module_nodes, {})
    module_locals = {n.name for n in tree.body if isinstance(n, DEFINITIONS)}
    module_locals.update(n.id for n in module_nodes if isinstance(n, ast.Name) and isinstance(n.ctx, ast.Store))
    functions = []
    parents = common.parents(tree)

    def inspect(fn, qualified, inherited):
        scope = common.NodeIndex(walk(fn.body))
        binding_nodes = scope.select((ast.Import, ast.ImportFrom, ast.Name))
        bindings = bindings_in(binding_nodes, inherited)
        params = [a.arg for a in [*getattr(fn.args, 'posonlyargs', []), *fn.args.args, *fn.args.kwonlyargs]]
        parameter_indices = {}
        for index, name in enumerate(params):
            parameter_indices.setdefault(name, str(index))
        aliases, blocked = {}, set(params)
        for node in scope.select((ast.Name,) + DEFINITIONS):
            if isinstance(node, ast.Name) and isinstance(node.ctx, (ast.Store, ast.Del)):
                blocked.add(node.id)
            if isinstance(node, DEFINITIONS):
                blocked.add(node.name)
        for name in blocked:
            bindings.pop(name, None)
        # Imports inside a function override its lexical local binding.
        bindings = bindings_in(binding_nodes, bindings)
        for node in scope.select((ast.Assign, ast.AnnAssign, ast.ExceptHandler)):
            if isinstance(node, (ast.Assign, ast.AnnAssign)):
                targets = node.targets if isinstance(node, ast.Assign) else [node.target]
                for target in targets:
                    if isinstance(target, ast.Name):
                        aliases.setdefault(target.id, []).append(node.value)
            elif isinstance(node, ast.ExceptHandler) and node.name:
                aliases[node.name] = []
        children = {node.name: qualified + '.' + node.name for node in scope.select(DEFINITIONS)}
        # Only event nodes and their ancestors need the context-sensitive walk.
        # The full scope list still supplies references, bindings and assertions.
        active = set()
        for node in scope.select((ast.ExceptHandler, ast.Assert, ast.Raise, ast.Call, ast.With, ast.AsyncWith, ast.Try)):
            while node is not None and node is not fn and node not in active:
                active.add(node)
                node = parents.get(node)

        def tokens(node, depth=0):
            if node is None:
                return set()
            if isinstance(node, list):
                return set().union(*(tokens(n, depth) for n in node)) if node else set()
            return node_tokens(node, depth)

        @lru_cache(maxsize=None)
        def node_tokens(node, depth):
            if isinstance(node, DEFINITIONS):
                return set()
            if isinstance(node, ast.Call) and common.dotted(node.func) == 'getattr':
                return set()
            name = common.dotted(node) if isinstance(node, (ast.Name, ast.Attribute)) else ''
            if name and not name.startswith('.'):
                head = name.split('.')[0]
                if head in children:
                    return {'!' + children[head]}
                if head in parameter_indices:
                    return {'$' + parameter_indices[head]}
                if head in aliases and depth < 2 and len(aliases[head]) == 1:
                    return tokens(aliases[head][0], depth + 1)
                if head in blocked and head not in bindings:
                    return set()
                return {name}
            if isinstance(node, ast.Subscript):
                key = common.failure_values.index(node)
                return tokens(node.value, depth) if isinstance(key, ast.Constant) and isinstance(key.value, str) else set()
            if isinstance(node, ast.Attribute):
                return tokens(node.value, depth)
            return set().union(*(tokens(n, depth) for n in common.children(node)))

        @lru_cache(maxsize=None)
        def canonical(node):
            name = common.dotted(node)
            head, _, tail = name.partition('.')
            binding = bindings.get(head)
            if binding and binding['level'] == 0:
                return '.'.join(p for p in [binding['module'], '' if binding['imported'] == '*' else binding['imported'], tail] if p)
            if head in blocked or head in module_locals or '.' in name and head in ('sys', 'os', 'time', 'pytest'):
                return ''
            return name

        def is_assert(node):
            if isinstance(node, ast.Assert):
                return True
            if not isinstance(node, ast.Call):
                return False
            name = canonical(node.func)
            return (isinstance(node.func, ast.Attribute) and node.func.attr.startswith('assert')) or name in (
                'pytest.raises', 'pytest.warns', 'pytest.deprecated_call', 'pytest.fail')

        def is_raises(node):
            if not isinstance(node, ast.Call):
                return False
            return canonical(node.func) == 'pytest.raises' or common.dotted(node.func) in (
                'self.assertRaises', 'self.assertRaisesRegex')

        def catches_assertion(node):
            if node is None:
                return True
            if isinstance(node, ast.Tuple):
                return any(catches_assertion(item) for item in node.elts)
            return canonical(node).replace('builtins.', '') in ('AssertionError', 'Exception', 'BaseException')

        failures, exits, calls, smells = [], [], [], set()
        def failure(node, subject, kind='throws', expected=None):
            targets = tokens(subject)
            failures.append({'line': node.lineno, 'kind': kind, 'targets': sorted(targets),
                             'expectedTargets': sorted(tokens(expected) - targets)})

        def visit(node, caught=False, inline=False, removable=False):
            if node not in active:
                return
            removable = removable or isinstance(node, ast.Assert)
            if isinstance(node, DEFINITIONS):
                return
            if isinstance(node, ast.ExceptHandler):
                if not caught:
                    probe = node.body[0].lineno if node.body else None
                    exits.append({'line': node.lineno, 'kind': 'catch', 'probe': probe})
                for child in node.body:
                    visit(child, True, False)
                return
            if isinstance(node, ast.Assert) and not caught:
                value_check = common.failure_values.check(node.test)
                if value_check:
                    kind, subject, expected = value_check
                    failure(node, subject, kind, expected)
            if isinstance(node, ast.Raise) and not caught:
                exits.append({'line': node.lineno, 'kind': 'throw', **({'probe': None} if inline else {})})
            if isinstance(node, ast.Call):
                name = canonical(node.func)
                exit_call = name in ('sys.exit', 'exit', 'quit', 'os._exit')
                status = node.args[0] if node.args else next((k.value for k in node.keywords if k.arg in ('code', 'status')), None)
                zero = isinstance(status, ast.Constant) and status.value in (0, None)
                if not caught and not removable and (name == 'os.abort' or exit_call and status is not None and not zero):
                    exits.append({'line': node.lineno, 'kind': 'exit', **({'probe': None} if inline else {})})
                if name == 'time.sleep' and any(isinstance(a, ast.Constant) and isinstance(a.value, (int, float)) for a in node.args):
                    smells.add('fixed-wait')
                if is_raises(node) and len(node.args) > (2 if common.dotted(node.func).endswith('Regex') else 1):
                    index = 2 if common.dotted(node.func).endswith('Regex') else 1
                    failure(node, node.args[index], expected=node.args[:index] + node.args[index + 1:] + [k.value for k in node.keywords])
                call_tokens = tokens(node.func)
                if len(call_tokens) == 1:
                    calls.append({'callee': next(iter(call_tokens)), 'arguments': [sorted(tokens(a)) for a in node.args],
                                  'keywords': {k.arg: sorted(tokens(k.value)) for k in node.keywords if k.arg is not None}})
            if isinstance(node, (ast.With, ast.AsyncWith)):
                for item in node.items:
                    if is_raises(item.context_expr) and len(item.context_expr.args) <= 1 or (
                        is_raises(item.context_expr) and common.dotted(item.context_expr.func).endswith('Regex') and len(item.context_expr.args) == 2):
                        failure(item.context_expr, node.body, expected=item.context_expr.args)
            if isinstance(node, ast.Try):
                assertions = [n for n in walk(node.body) if is_assert(n)]
                for handler in node.handlers:
                    hidden = all(isinstance(n, ast.Pass) or isinstance(n, ast.Expr) and isinstance(n.value, ast.Constant) for n in handler.body)
                    if assertions and hidden and catches_assertion(handler.type):
                        smells.add('swallowed-error')
                    if handler.name:
                        for check in walk(handler.body):
                            ordinary = isinstance(check, ast.Assert) or (isinstance(check, ast.Call) and isinstance(check.func, ast.Attribute)
                                and check.func.attr.startswith('assert') and not is_raises(check))
                            if ordinary and any(isinstance(n, ast.Name) and n.id == handler.name for n in ast.walk(check)):
                                failure(check, node.body, 'error-value')
            for child in common.children(node):
                on_line = inline or isinstance(node, ast.If) and child.lineno == node.lineno and child in node.body + node.orelse
                visit(child, caught, on_line, removable)

        for statement in fn.body:
            visit(statement)
        returned = scope.select(ast.Return)
        last = fn.body[-1] if fn.body else None
        factory = children.get(last.value.id) if len(returned) == 1 and last is returned[0] and isinstance(last.value, ast.Name) else None
        distinct_exits = {}
        for exit_record in exits:
            distinct_exits.setdefault(exit_record['line'], exit_record)
        functions.append({'factory': factory, 'name': qualified, 'line': fn.lineno, 'parameters': params, 'bindings': bindings,
                          'blocked': sorted(blocked - set(bindings)), 'fixture': any(common.dotted(d).split('.')[-1] == 'fixture' for d in fn.decorator_list),
                          'assertions': sum(is_assert(n) for n in scope.select((ast.Assert, ast.Call))), 'failures': failures,
                          'references': sorted(tokens(fn.body)), 'calls': calls, 'exits': list(distinct_exits.values()), 'smells': sorted(smells)})
        for node in scope.select(DEFINITIONS):
            if isinstance(node, FUNCTIONS):
                inspect(node, qualified + '.' + node.name, bindings)
            elif isinstance(node, ast.ClassDef):
                definitions([node], qualified + '.', bindings)

    def definitions(nodes, prefix='', inherited=None):
        inherited = module_bindings if inherited is None else inherited
        for node in nodes:
            if isinstance(node, FUNCTIONS):
                inspect(node, prefix + node.name, inherited)
            elif isinstance(node, ast.ClassDef):
                # Class ranges carry explicit base/decorator references, as on the TypeScript side.
                functions.append({'factory': None, 'name': prefix + node.name, 'line': node.lineno,
                    'parameters': [], 'bindings': inherited, 'blocked': [], 'fixture': False,
                    'assertions': 0, 'failures': [], 'calls': [], 'exits': [], 'smells': [],
                    'references': sorted(set(common.dotted(n) for n in node.bases + node.decorator_list if isinstance(n, (ast.Name, ast.Attribute))))})
                definitions(node.body, prefix + node.name + '.', inherited)
            else:
                definitions(common.children(node), prefix, inherited)
    definitions(tree.body)
    return {'failureFacts': functions, 'failureBindings': module_bindings}
