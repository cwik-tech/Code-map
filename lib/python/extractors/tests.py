import ast

NAME = 'cases'
FUNCTIONS = common.FUNCTIONS
dotted = common.dotted


def marker_info(decorators):
    status, expected, count = 'active', False, 1
    parametrized, unknown = False, False
    for decorator in decorators:
        name = dotted(decorator).split('.')[-1]
        if name in ('skip', 'skipIf', 'skipUnless'):
            status = 'skipped' if name == 'skip' else 'conditional'
        elif name == 'skipif' and status != 'skipped':
            status = 'conditional'
        elif name in ('xfail', 'expectedFailure'):
            expected = True
            if status == 'active':
                status = 'expected-failure'
        elif name == 'parametrize' and isinstance(decorator, ast.Call):
            parametrized = True
            values = decorator.args[1] if len(decorator.args) > 1 else next((k.value for k in decorator.keywords if k.arg == 'argvalues'), None)
            size = len(values.elts) if isinstance(values, (ast.List, ast.Tuple, ast.Set)) else None
            unknown = unknown or size is None
            if size is not None:
                count *= size
    return status, expected, count if parametrized and not unknown else None


def pytest_bindings(nodes, bindings=None):
    result = dict(bindings or {})
    for node in nodes:
        if isinstance(node, ast.Import):
            for alias in node.names:
                if alias.name == 'pytest':
                    result[alias.asname or alias.name] = 'pytest'
        elif isinstance(node, ast.ImportFrom) and node.module == 'pytest' and node.level == 0:
            for alias in node.names:
                result[alias.asname or alias.name] = 'pytest.' + alias.name
    return result


def assertion(node, bindings):
    if isinstance(node, ast.Assert):
        return True
    if not isinstance(node, ast.Call):
        return False
    if isinstance(node.func, ast.Attribute) and node.func.attr.startswith('assert'):
        return True
    parts = dotted(node.func).split('.')
    name = '.'.join([bindings.get(parts[0], ''), *parts[1:]])
    return name in ('pytest.raises', 'pytest.warns', 'pytest.deprecated_call', 'pytest.fail')


def cases_of(tree):
    cases = []
    bindings = pytest_bindings(tree.body)
    def add(node, suite='', decorators=()):
        status, expected, count = marker_info(list(decorators) + node.decorator_list)
        local = pytest_bindings(ast.walk(node), bindings)
        assertions = sum(assertion(n, local) for n in ast.walk(node))
        cases.append({'name': node.name, 'suite': suite, 'line': node.lineno, 'status': status,
                      'expectedFailure': expected, 'each': count, 'assertions': assertions,
                      'failures': [], 'references': [], 'smells': [], 'plan': False, 'subtests': 0})
    for node in tree.body:
        if isinstance(node, FUNCTIONS) and node.name.startswith('test'):
            add(node)
        elif isinstance(node, ast.ClassDef) and (node.name.startswith('Test') or any(dotted(b).endswith('TestCase') for b in node.bases)):
            for method in node.body:
                if isinstance(method, FUNCTIONS) and method.name.startswith('test'):
                    add(method, node.name, node.decorator_list)
    return cases


def extract(tree, text, path):
    return cases_of(tree)
