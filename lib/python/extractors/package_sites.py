"""Entry guards, conditional imports and loader reach. No export facts."""
import ast
import re

NAME = 'packageSites'
dotted = common.dotted


def prefix(node):
    if isinstance(node, ast.Constant) and isinstance(node.value, str):
        return node.value
    if isinstance(node, ast.BinOp) and isinstance(node.op, ast.Add):
        return prefix(node.left)
    if isinstance(node, ast.JoinedStr):
        return ''.join(n.value for n in node.values[:1] if isinstance(n, ast.Constant) and isinstance(n.value, str))
    return ''


def intercepted_modules(call, name):
    if not isinstance(call, ast.Call) or name(call.func) != 'unittest.mock.patch.dict':
        return []
    keywords = {k.arg: k.value for k in call.keywords if k.arg is not None}
    target = call.args[0] if call.args else keywords.get('in_dict')
    if not (isinstance(target, ast.Constant) and target.value == 'sys.modules' or name(target) == 'sys.modules'):
        return []
    values = call.args[1] if len(call.args) > 1 else keywords.get('values')
    if values is None:
        modules = []
    elif isinstance(values, ast.Dict):
        modules = [k.value if isinstance(k, ast.Constant) and isinstance(k.value, str) else None for k in values.keys]
    else:
        modules = [None]
    modules.extend(k.arg for k in call.keywords if k.arg not in ('in_dict', 'values', 'clear'))
    return modules


def static_imports(node):
    if isinstance(node, ast.Import):
        return [alias.name for alias in node.names]
    if isinstance(node, ast.ImportFrom):
        return [node.module or '']
    return []


def extract(tree, text, path):
    guards, suppressed, dynamic, mocked, optional = [], set(), [], set(), set()
    aliases = {}
    for node in common.nodes(tree, (ast.Import, ast.ImportFrom)):
        if isinstance(node, ast.Import):
            for alias in node.names:
                aliases[alias.asname or alias.name] = alias.name
        elif isinstance(node, ast.ImportFrom):
            for alias in node.names:
                aliases[alias.asname or alias.name] = (node.module or '') + '.' + alias.name
    def name(node):
        value = dotted(node)
        first = value.split('.')[0]
        return aliases.get(first, first) + value[len(first):]
    def visit_optional(node, protected=()):
        for module in static_imports(node):
            if any(module == p or module.startswith(p + '.') for p in protected):
                optional.add((node.lineno, module))
        for _, value in ast.iter_fields(node):
            if isinstance(value, list):
                active = list(protected)
                for child in value:
                    if not isinstance(child, ast.AST):
                        continue
                    call = child.value if isinstance(child, (ast.Expr, ast.Assign, ast.AnnAssign)) else None
                    if isinstance(call, ast.Call) and name(call.func) == 'pytest.importorskip' and call.args:
                        arg = call.args[0]
                        if isinstance(arg, ast.Constant) and isinstance(arg.value, str):
                            active.append(arg.value)
                    visit_optional(child, active)
            elif isinstance(value, ast.AST):
                visit_optional(value, protected)
    if any(name(node.func) == 'pytest.importorskip' for node in common.nodes(tree, ast.Call)):
        visit_optional(tree)
    for node in tree.body:
        if isinstance(node, ast.If) and isinstance(node.test, ast.Compare) and len(node.test.ops) == 1 and isinstance(node.test.ops[0], ast.Eq):
            sides = [node.test.left, *node.test.comparators]
            if any(isinstance(n, ast.Name) and n.id == '__name__' for n in sides) and any(isinstance(n, ast.Constant) and n.value == '__main__' for n in sides):
                guards.append(node.lineno)
    for node in common.nodes(tree, (ast.With, ast.AsyncWith, ast.If, ast.Call, ast.Assign, ast.AugAssign)):
        if isinstance(node, (ast.With, ast.AsyncWith)):
            modules = [m for item in node.items for m in intercepted_modules(item.context_expr, name)]
            for body in node.body if modules else []:
                for child in ast.walk(body):
                    imported = static_imports(child)
                    if isinstance(child, ast.Call) and name(child.func) in ('importlib.import_module', '__import__', 'builtins.__import__'):
                        arg = child.args[0] if child.args else None
                        if isinstance(arg, ast.Constant) and isinstance(arg.value, str):
                            imported = [arg.value]
                    for module in imported:
                        if any(m is None or module == m or module.startswith(m + '.') for m in modules):
                            mocked.add((child.lineno, module))
        if isinstance(node, ast.If):
            condition = list(ast.walk(node.test))
            conditional = any(name(n) in ('typing.TYPE_CHECKING', 'TYPE_CHECKING', 'sys.platform', 'os.name')
                              or name(n).startswith('platform.') for n in condition if isinstance(n, (ast.Name, ast.Attribute, ast.Call)))
            if conditional:
                for body in [*node.body, *node.orelse]:
                    for child in ast.walk(body):
                        if isinstance(child, (ast.Import, ast.ImportFrom, ast.Call)):
                            suppressed.add(child.lineno)
        if isinstance(node, ast.Call):
            call = name(node.func)
            if call in ('importlib.import_module', '__import__', 'builtins.__import__'):
                argument = node.args[0] if node.args else None
                if dotted(node.func) not in ('importlib.import_module', '__import__') or not (isinstance(argument, ast.Constant) and isinstance(argument.value, str)):
                    dynamic.append({'prefix': prefix(argument), 'reason': 'dynamic-import', 'line': node.lineno})
            elif call in ('importlib.util.spec_from_file_location', 'importlib.util.spec_from_loader') or call.endswith('.exec_module'):
                dynamic.append({'prefix': '', 'reason': 'file-module-loader', 'line': node.lineno})
            elif call.startswith(('pkgutil.', 'importlib.resources.')) or call.endswith(('.entry_points', '.iter_entry_points', '.load_entry_point')):
                dynamic.append({'prefix': '', 'reason': 'plugin-or-resource-loader', 'line': node.lineno})
            elif call.startswith('sys.path.'):
                dynamic.append({'prefix': '', 'reason': 'sys-path-change', 'line': node.lineno})
        elif isinstance(node, (ast.Assign, ast.AugAssign)):
            targets = node.targets if isinstance(node, ast.Assign) else [node.target]
            if any(name(n) == 'sys.path' or isinstance(n, ast.Subscript) and name(n.value) == 'sys.path' for n in targets):
                dynamic.append({'prefix': '', 'reason': 'sys-path-change', 'line': node.lineno})
    references = sorted(set(node.value for node in common.nodes(tree, ast.Constant) if isinstance(node, ast.Constant)
                            and isinstance(node.value, str) and len(node.value) <= 256
                            and re.fullmatch(r'[A-Za-z_][\w.-]*(?::[A-Za-z_][\w.]*)?', node.value)))
    return {'guards': guards, 'suppressed': sorted(suppressed), 'dynamic': dynamic, 'references': references,
            'mocked': [{'line': line, 'module': module} for line, module in sorted(mocked)],
            'optional': [{'line': line, 'module': module} for line, module in sorted(optional)]}
