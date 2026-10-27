"""Public names and syntax signatures. Project code is never executed."""
import ast
from collections import Counter

NAME = 'publicApi'


def source(node, text):
    return common.source_segment(text, node) if node is not None else None


def default(node):
    if node is None:
        return {'exists': False}
    try:
        value = ast.literal_eval(node)
        if value is None or isinstance(value, (str, bool, int, float)):
            return {'exists': True, 'literal': repr(value)}
    except (ValueError, TypeError, SyntaxError):
        pass
    return {'exists': True}


def decorators(node, text):
    forms = ('staticmethod', 'classmethod', 'property', 'setter', 'deleter', 'overload', 'dataclass')
    return [source(d, text) for d in node.decorator_list if common.dotted(d).split('.')[-1] in forms]


def function(node, text):
    args = node.args
    positional = [*args.posonlyargs, *args.args]
    defaults = [None] * (len(positional) - len(args.defaults)) + list(args.defaults)
    def parameter(arg, kind, value=None):
        return {'name': arg.arg, 'kind': kind, 'annotation': source(arg.annotation, text), 'default': default(value)}
    params = [parameter(arg, 'positional-only' if i < len(args.posonlyargs) else 'positional-or-keyword', defaults[i])
              for i, arg in enumerate(positional)]
    if args.vararg:
        params.append(parameter(args.vararg, 'var-positional'))
    params.extend(parameter(arg, 'keyword-only', value) for arg, value in zip(args.kwonlyargs, args.kw_defaults))
    if args.kwarg:
        params.append(parameter(args.kwarg, 'var-keyword'))
    return {'parameters': params, 'returns': source(node.returns, text),
            'async': isinstance(node, ast.AsyncFunctionDef), 'decorators': decorators(node, text)}


def signatures(nodes, text):
    nodes = [n for n in nodes if isinstance(n, common.FUNCTIONS)]
    overloaded = [n for n in nodes if any(common.dotted(d).split('.')[-1] == 'overload' for d in n.decorator_list)]
    properties = [n for n in nodes if any(common.dotted(d).split('.')[-1] in ('property', 'setter', 'deleter') for d in n.decorator_list)]
    return [function(n, text) for n in overloaded or properties or nodes[-1:]]


def class_shape(node, text):
    methods, fields = {}, []
    for child in node.body:
        if isinstance(child, common.FUNCTIONS) and (not child.name.startswith('_') or child.name in ('__init__', '__new__')):
            methods.setdefault(child.name, []).append(child)
        if isinstance(child, ast.AnnAssign) and isinstance(child.target, ast.Name) and not child.target.id.startswith('_'):
            fields.append({'name': child.target.id, 'annotation': source(child.annotation, text), 'default': default(child.value)})
    return {'bases': [source(b, text) for b in node.bases], 'keywords': [('**' if k.arg is None else k.arg + '=') + (source(k.value, text) or '') for k in node.keywords], 'decorators': decorators(node, text),
            'methods': {name: signatures(items, text) for name, items in methods.items()}, 'fields': fields}


def declaration_record(name, nodes, text, references):
    node = nodes[-1]
    kind = 'class' if isinstance(node, ast.ClassDef) else 'function' if isinstance(node, common.FUNCTIONS) else 'variable'
    if kind == 'class':
        shape = class_shape(node, text)
    elif kind == 'function':
        shape = {'signatures': signatures(nodes, text)}
    else:
        shape = {'annotation': source(getattr(node, 'annotation', None), text)}
    return {'name': name, 'kind': kind, 'line': node.lineno, 'shape': shape, 'localReferences': references[name]}


def literal_names(node):
    if not isinstance(node, (ast.List, ast.Tuple)):
        return None
    return [n.value for n in node.elts] if all(isinstance(n, ast.Constant) and isinstance(n.value, str) for n in node.elts) else None


def conditional_names(tree):
    found = set()
    def visit(node):
        if isinstance(node, common.DEFINITIONS):
            found.add(node.name)
            return
        if isinstance(node, (ast.Assign, ast.AnnAssign)):
            targets = node.targets if isinstance(node, ast.Assign) else [node.target]
            found.update(n.id for t in targets for n in ast.walk(t) if isinstance(n, ast.Name) and isinstance(n.ctx, ast.Store))
        if not isinstance(node, ast.Lambda):
            for child in common.children(node):
                visit(child)
    for node in tree.body:
        if isinstance(node, (ast.If, ast.Try, ast.For, ast.While, ast.With)) or type(node).__name__ == 'Match':
            visit(node)
    return found


def extract(tree, text, path):
    supported_all = set()
    defined, bindings, declared, explicit, unknown = {}, [], None, False, []
    for node in tree.body:
        if isinstance(node, common.DEFINITIONS):
            defined.setdefault(node.name, []).append(node)
        if isinstance(node, (ast.Import, ast.ImportFrom)):
            for alias in node.names:
                if alias.name == '*':
                    unknown.append('star-import')
                    continue
                name = alias.asname or (alias.name.split('.')[0] if isinstance(node, ast.Import) else alias.name)
                bindings.append({'local': name, 'name': alias.name if isinstance(node, ast.ImportFrom) else '*',
                                 'module': node.module or '' if isinstance(node, ast.ImportFrom) else alias.name,
                                 'level': node.level if isinstance(node, ast.ImportFrom) else 0,
                                 'line': node.lineno, 'explicit': alias.asname == alias.name})
        targets = node.targets if isinstance(node, ast.Assign) else [node.target] if isinstance(node, (ast.AnnAssign, ast.AugAssign)) else []
        for target in targets:
            if isinstance(target, ast.Name) and target.id == '__all__':
                supported_all.update(ast.walk(node))
                explicit = True
                names = literal_names(node.value)
                if isinstance(node, ast.AugAssign):
                    declared = declared + names if declared is not None and names is not None and isinstance(node.op, ast.Add) else None
                else:
                    declared = names
            elif not isinstance(node, ast.AugAssign):
                for name in ast.walk(target):
                    if isinstance(name, ast.Name) and isinstance(name.ctx, ast.Store):
                        defined[name.id] = [node]
        if isinstance(node, ast.Expr) and isinstance(node.value, ast.Call):
            call = node.value
            if common.dotted(call.func).startswith('__all__.'):
                supported_all.update(ast.walk(node))
                explicit = True
                names = literal_names(call.args[0]) if call.args and common.dotted(call.func) == '__all__.extend' else None
                declared = declared + names if declared is not None and names is not None else None
    for node in common.nodes(tree, (ast.Name, ast.Call, ast.Subscript)):
        writes_all = isinstance(node, ast.Name) and node.id == '__all__' and isinstance(node.ctx, (ast.Store, ast.Del))
        mutates_all = isinstance(node, ast.Call) and common.dotted(node.func).startswith('__all__.')
        replaces_item = isinstance(node, ast.Subscript) and common.dotted(node.value) == '__all__' and isinstance(node.ctx, (ast.Store, ast.Del))
        if node not in supported_all and (writes_all or mutates_all or replaces_item):
            explicit, declared = True, None
    imported = {b['local']: b for b in bindings}
    public = declared if explicit else [n for n in defined if not n.startswith('_')] + [b['local'] for b in bindings if b['explicit']]
    state = 'UNKNOWN' if explicit and declared is None else 'KNOWN'
    records, missing = [], []
    references = Counter(n.id for n in common.nodes(tree, ast.Name) if isinstance(n, ast.Name) and isinstance(n.ctx, ast.Load))
    public_names = set(public or [])
    for name in sorted(public_names):
        nodes = defined.get(name)
        if nodes:
            records.append(declaration_record(name, nodes, text, references))
        elif name in imported:
            records.append({'name': name, 'kind': 'reexport', 'line': imported[name]['line'], 'binding': imported[name]})
        else:
            missing.append(name)
    for record in records:
        record['declared'] = explicit or record.get('binding', {}).get('explicit', False)
    if not explicit:
        missing.extend(sorted(n for n in conditional_names(tree) if not n.startswith('_') and n not in defined))
    hidden = [declaration_record(name, nodes, text, references) for name, nodes in defined.items() if name not in public_names]
    return {'state': state, 'reason': 'computed-__all__' if state == 'UNKNOWN' else None,
            'unknownNames': missing, 'uncertainty': unknown, 'exports': records, 'hidden': hidden, 'bindings': bindings}
