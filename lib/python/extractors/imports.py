import ast

NAME = 'imports'
dotted = common.dotted


def catches_import_error(node):
    if node is None:
        return True
    if isinstance(node, ast.Tuple):
        return any(catches_import_error(item) for item in node.elts)
    return isinstance(node, ast.Name) and node.id in (
        'ImportError', 'ModuleNotFoundError', 'Exception', 'BaseException')


def optional_imports(tree):
    optional = set()
    def visit(node, protected=False):
        if protected and isinstance(node, (ast.Import, ast.ImportFrom, ast.Call)):
            optional.add(node)
        if isinstance(node, ast.Try):
            catches = any(catches_import_error(handler.type) for handler in node.handlers)
            for child in node.body:
                visit(child, protected or catches)
            for child in [*node.handlers, *node.orelse, *node.finalbody]:
                visit(child, protected)
        else:
            for child in ast.iter_child_nodes(node):
                visit(child, protected)
    visit(tree)
    return optional


def extract(tree, text, path):
    imports = []
    optional = optional_imports(tree)
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                imports.append({'level': 0, 'module': alias.name, 'names': [], 'line': node.lineno, 'dynamic': False, 'optional': node in optional})
        elif isinstance(node, ast.ImportFrom):
            imports.append({'level': node.level, 'module': node.module or '', 'names': [n.name for n in node.names], 'line': node.lineno, 'dynamic': False, 'optional': node in optional})
        elif isinstance(node, ast.Call) and dotted(node.func) in ('importlib.import_module', '__import__'):
            value = node.args[0] if node.args else None
            literal = value.value if isinstance(value, ast.Constant) and isinstance(value.value, str) else None
            level = len(literal) - len(literal.lstrip('.')) if literal else 0
            imports.append({'level': level, 'module': literal.lstrip('.') if literal else None, 'names': [], 'line': node.lineno, 'dynamic': True, 'optional': node in optional})
    return imports
