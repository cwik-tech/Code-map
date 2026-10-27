"""Parse supplied text only. Never import or execute a project module."""
import ast
import json
import sys
import configparser

# Fixed Python 3.8/3.9 fallback. New interpreters provide their own exact set.
STDLIB = set(('abc argparse array ast asyncio atexit base64 bdb binascii bisect builtins bz2 calendar cgi '
             'cgitb chunk cmath cmd code codecs codeop collections colorsys compileall concurrent configparser '
             'contextlib contextvars copy copyreg cProfile csv ctypes curses dataclasses datetime dbm decimal '
             'difflib dis distutils doctest email encodings ensurepip enum errno faulthandler fcntl filecmp '
             'fileinput fnmatch fractions ftplib functools gc getopt getpass gettext glob graphlib grp gzip '
             'hashlib heapq hmac html http idlelib imaplib imghdr imp importlib inspect io ipaddress itertools '
             'json keyword lib2to3 linecache locale logging lzma mailbox mailcap marshal math mimetypes mmap '
             'modulefinder multiprocessing netrc nis nntplib numbers operator optparse os pathlib pdb pickle '
             'pickletools pipes pkgutil platform plistlib poplib posix posixpath pprint profile pstats pty pwd '
             'py_compile pyclbr pydoc queue quopri random re readline reprlib resource rlcomple rlcompleter '
             'runpy sched secrets select selectors shelve shlex shutil signal site smtpd smtplib sndhdr socket '
             'socketserver spwd sqlite3 ssl stat statistics string stringprep struct subprocess sunau symbol '
             'symtable sys sysconfig syslog tabnanny tarfile telnetlib tempfile termios test textwrap threading '
             'time timeit tkinter token tokenize trace traceback tracemalloc tty turtle turtledemo types '
             'typing unicodedata unittest urllib uu uuid venv warnings wave weakref webbrowser wsgiref xdrlib '
             'xml xmlrpc zipapp zipfile zipimport zlib zoneinfo __future__').split())
FUNCTIONS = (ast.FunctionDef, ast.AsyncFunctionDef)
DEFINITIONS = FUNCTIONS + (ast.ClassDef,)


def dotted(node):
    if isinstance(node, ast.Call):
        return dotted(node.func)
    if isinstance(node, ast.Name):
        return node.id
    if isinstance(node, ast.Attribute):
        return dotted(node.value) + '.' + node.attr
    return ''


def complexity(node):
    decisions, maximum = [1], [0]

    def visit(child, depth):
        if isinstance(child, DEFINITIONS + (ast.Lambda,)):
            return
        control = isinstance(child, (ast.If, ast.For, ast.AsyncFor, ast.While, ast.IfExp, ast.ExceptHandler))
        if control:
            decisions[0] += 1
            depth += 1
            maximum[0] = max(maximum[0], depth)
        if isinstance(child, ast.BoolOp):
            decisions[0] += len(child.values) - 1
        if isinstance(child, ast.comprehension):
            decisions[0] += 1 + len(child.ifs)
            maximum[0] = max(maximum[0], depth + 1)
        if type(child).__name__ == 'match_case':
            decisions[0] += 1
            depth += 1
            maximum[0] = max(maximum[0], depth)
        for inner in ast.iter_child_nodes(child):
            visit(inner, depth)
    for statement in node.body:
        visit(statement, 0)
    return {'cyclomatic': decisions[0], 'nesting': maximum[0]}


def definitions_in(nodes, method=False):
    result = []
    for node in nodes:
        if isinstance(node, DEFINITIONS):
            result.append(definition(node, method))
        else:
            result.extend(definitions_in(ast.iter_child_nodes(node), method))
    return result


def definition(node, method=False):
    return {'name': node.name, 'kind': 'class' if isinstance(node, ast.ClassDef) else 'method' if method else 'function',
            'async': isinstance(node, ast.AsyncFunctionDef), 'start': node.lineno, 'end': node.end_lineno,
            'decorators': [dotted(d) for d in node.decorator_list],
            'complexity': complexity(node) if isinstance(node, FUNCTIONS) else None,
            'children': definitions_in(node.body, isinstance(node, ast.ClassDef))}


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


def facts(item):
    try:
        tree = ast.parse(item['text'], filename=item['path'])
    except (SyntaxError, ValueError, RecursionError) as error:
        return {'path': item['path'], 'imports': [], 'definitions': [], 'all': None, 'names': [], 'cases': [],
                'errors': [{'line': getattr(error, 'lineno', 1) or 1, 'message': str(error)}]}
    imports, names, exports = [], [], None
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
    for node in tree.body:
        if isinstance(node, (ast.Import, ast.ImportFrom)):
            names.extend(alias.asname or alias.name.split('.')[0] for alias in node.names if alias.name != '*')
        if isinstance(node, DEFINITIONS):
            names.append(node.name)
        if isinstance(node, (ast.Assign, ast.AnnAssign)):
            targets = node.targets if isinstance(node, ast.Assign) else [node.target]
            names.extend(n.id for target in targets for n in ast.walk(target) if isinstance(n, ast.Name))
            if any(isinstance(target, ast.Name) and target.id == '__all__' for target in targets):
                try:
                    value = ast.literal_eval(node.value)
                    exports = value if isinstance(value, (list, tuple)) and all(isinstance(v, str) for v in value) else None
                except (ValueError, TypeError):
                    pass
    return {'path': item['path'], 'imports': imports, 'definitions': definitions_in(tree.body),
            'all': exports, 'names': names, 'cases': cases_of(tree), 'errors': []}


def configuration(texts):
    result = {}
    # Read only the relevant literal TOML sections. Python 3.8 has no tomllib.
    for path in ('pytest.ini', 'pyproject.toml', 'setup.cfg'):
        if path not in texts:
            continue
        if path == 'pyproject.toml':
            try:
                import tomllib
                data = tomllib.loads(texts[path])
                result.update(data.get('tool', {}).get('pytest', {}).get('ini_options', {}))
            except ImportError:
                result['_tomlFallback'] = texts[path]
            except ValueError:
                pass
        else:
            parser = configparser.ConfigParser(interpolation=None, strict=False)
            try:
                parser.read_string(texts[path])
                section = 'pytest' if path == 'pytest.ini' else 'tool:pytest'
                if parser.has_section(section):
                    result.update(dict(parser.items(section)))
            except configparser.Error:
                pass
        if 'testpaths' in result or 'python_files' in result:
            break
    return {key: value for key, value in result.items() if key in ('testpaths', 'python_files', '_tomlFallback')}


payload = json.loads(sys.stdin.buffer.read().decode('utf-8'))
texts = {item['path']: item['text'] for item in payload if not item['path'].endswith('.py')}
print(json.dumps({'files': [facts(item) for item in payload if item['path'].endswith('.py')],
                  'stdlib': sorted(getattr(sys, 'stdlib_module_names', STDLIB)),
                  'config': configuration(texts)}))
