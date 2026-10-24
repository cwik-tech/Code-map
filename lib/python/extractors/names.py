import ast

NAME = None
DEFINITIONS = common.DEFINITIONS


def extract(tree, text, path):
    names, exports = [], None
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
    return {'all': exports, 'names': names}
