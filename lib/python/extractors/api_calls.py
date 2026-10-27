"""Call facts independent of failure-path reference extraction."""
import ast
from collections import Counter

NAME = 'apiCalls'


def extract(tree, text, path):
    result = []
    aliases = {}
    for node in common.nodes(tree, ast.Assign):
        if isinstance(node, ast.Assign):
            value = common.dotted(node.value)
            if value:
                for target in node.targets:
                    if isinstance(target, ast.Name):
                        aliases[target.id] = value
    # Rebinding and lexical shadowing prevent a definite imported-call claim.
    imported_counts = Counter()
    for node in common.nodes(tree, (ast.Import, ast.ImportFrom)):
        if isinstance(node, (ast.Import, ast.ImportFrom)):
            imported_counts.update(a.asname or a.name.split('.')[0] for a in node.names)
    shadowed = {name for name, count in imported_counts.items() if count > 1}
    for node in common.nodes(tree, common.DEFINITIONS + (ast.ExceptHandler, ast.arg, ast.Name)):
        if isinstance(node, common.DEFINITIONS) or isinstance(node, ast.ExceptHandler):
            if node.name:
                shadowed.add(node.name)
        if isinstance(node, ast.arg):
            shadowed.add(node.arg)
        if isinstance(node, ast.Name) and isinstance(node.ctx, ast.Store) and node.id not in aliases:
            shadowed.add(node.id)
    for node in common.nodes(tree, ast.Call):
        if not isinstance(node, ast.Call):
            continue
        name = common.dotted(node.func)
        reason = 'indirect-call' if isinstance(node.func, ast.Call) else None
        if isinstance(node.func, ast.Call) and common.dotted(node.func.func) == 'getattr':
            args = node.func.args
            if args:
                name = common.dotted(args[0]) + '.' + (args[1].value if len(args) > 1 and isinstance(args[1], ast.Constant) and isinstance(args[1].value, str) else '*')
                reason = 'getattr-call'
        first = name.split('.')[0]
        if first in aliases:
            name = aliases[first] + name[len(first):]
            reason = 'alias-call'
        if first in shadowed:
            reason = 'shadowed-binding'
        if any(isinstance(a, ast.Starred) for a in node.args) or any(k.arg is None for k in node.keywords):
            reason = 'spread-arguments'
        if name:
            result.append({'name': name, 'line': node.lineno, 'column': node.col_offset + 1,
                           'positional': len(node.args), 'keywords': [k.arg for k in node.keywords if k.arg is not None], 'reason': reason})
    parents = common.parents(tree)
    imported = set()
    for node in tree.body:
        if isinstance(node, (ast.Import, ast.ImportFrom)):
            imported.update(a.asname or a.name.split('.')[0] for a in node.names)
    for node in common.nodes(tree, ast.Name):
        if not isinstance(node, ast.Name) or not isinstance(node.ctx, ast.Load) or node.id not in imported:
            continue
        parent = parents.get(node)
        if isinstance(parent, ast.Attribute):
            continue
        if isinstance(parent, ast.Call) and (parent.func is node or common.dotted(parent.func) == 'getattr'):
            continue
        if isinstance(parent, ast.Assign) and any(isinstance(t, ast.Name) and t.id in aliases for t in parent.targets):
            continue
        result.append({'name': node.id, 'line': node.lineno, 'column': node.col_offset + 1,
                       'positional': 0, 'keywords': [], 'reason': 'escaped-binding'})
    return result
