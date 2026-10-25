"""Environment access and model test literals. No project code runs."""
import ast

NAME = 'settings'


def extract(tree, text, path):
    imports, helpers, bindings, parameters = {}, set(), {}, set()

    def bind(local, target):
        imports[local] = target if local not in imports or imports[local] == target else '<ambiguous>'

    for node in common.nodes(tree, (ast.Import, ast.ImportFrom)):
        if isinstance(node, ast.Import):
            for item in node.names:
                bind(item.asname or item.name.split('.')[0], item.name if item.asname else item.name.split('.')[0])
        elif isinstance(node, ast.ImportFrom):
            for item in node.names:
                bind(item.asname or item.name, (node.module or '') + '.' + item.name)

    # Suppress ambiguous aliases when any binding shadows an import. This trades recall for safety.
    for node in common.nodes(tree, common.DEFINITIONS + (ast.arg, ast.Name)):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            imports.pop(node.name, None)
            bindings[node.name] = bindings.get(node.name, 0) + 1
        elif isinstance(node, ast.arg):
            imports.pop(node.arg, None)
            parameters.add(node.arg)
        elif isinstance(node, ast.Name) and isinstance(node.ctx, (ast.Store, ast.Del)):
            imports.pop(node.id, None)
            bindings[node.id] = bindings.get(node.id, 0) + 1

    def name(node):
        raw = common.dotted(node)
        head, dot, tail = raw.partition('.')
        return imports.get(head, '') + dot + tail if head in imports else ''

    for node in common.nodes(tree, ast.Assign):
        if isinstance(node, ast.Assign) and isinstance(node.value, ast.Call) and name(node.value.func) == 'environ.Env':
            helpers.update(t.id for t in node.targets if isinstance(t, ast.Name) and bindings.get(t.id) == 1 and t.id not in parameters and t.id not in imports)
    reads = []
    numbers, strings, lengths, arrays, booleans, nulls = [], [], [], [], [], []
    parents = common.parents(tree)
    for node in common.nodes(tree, (ast.Subscript, ast.Call, ast.Constant, ast.UnaryOp, ast.List, ast.Tuple, ast.Set)):
        argument, via = None, None
        if isinstance(node, ast.Subscript) and isinstance(node.ctx, ast.Load) and name(node.value) == 'os.environ':
            argument = node.slice.value if isinstance(node.slice, ast.Index) else node.slice
            via = 'os.environ'
        elif isinstance(node, ast.Call):
            target = name(node.func)
            if target in ('os.getenv', 'os.environ.get', 'os.environ.setdefault', 'decouple.config') or (common.dotted(node.func).split('.')[0] in helpers and ('.' not in common.dotted(node.func) or common.dotted(node.func).split('.')[-1] in ('str', 'bool', 'int', 'float', 'list', 'tuple', 'dict', 'json', 'url', 'db', 'email', 'path', 'bytes'))):
                argument = node.args[0] if node.args else next((kw.value for kw in node.keywords if kw.arg in ('key', 'var')), None)
                via = target or 'environ.Env'
        if via:
            key = argument.value if isinstance(argument, ast.Constant) and isinstance(argument.value, str) else None
            reads.append({'name': key, 'line': node.lineno, 'via': via, 'form': ('element' if isinstance(node, ast.Subscript) else 'call') if key else 'computed', **({'state': 'UNKNOWN', 'reason': 'computed-name'} if key is None else {})})
        if isinstance(node, ast.Constant):
            if node.value is None:
                nulls.append(None)
            if type(node.value) is bool:
                booleans.append(node.value)
            if isinstance(node.value, bytes):
                lengths.append(len(node.value))
            if type(node.value) in (int, float) and abs(node.value) <= (9007199254740991 if type(node.value) is int else 1e308) and not isinstance(parents.get(node), ast.UnaryOp):
                numbers.append(node.value)
            if isinstance(node.value, str):
                strings.append(node.value)
                lengths.append(len(node.value))
        if isinstance(node, ast.UnaryOp) and isinstance(node.op, ast.USub) and isinstance(node.operand, ast.Constant) and type(node.operand.value) in (int, float) and abs(node.operand.value) <= (9007199254740991 if type(node.operand.value) is int else 1e308):
            numbers.append(-node.operand.value)
        if isinstance(node, (ast.List, ast.Tuple, ast.Set)) and not any(isinstance(e, ast.Starred) for e in node.elts):
            arrays.append(len(node.elts))
    return {'reads': reads, 'literals': {'numbers': numbers, 'strings': strings, 'stringLengths': lengths, 'arrayLengths': arrays, 'booleans': booleans, 'nulls': nulls}}
