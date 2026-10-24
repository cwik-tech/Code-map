import ast

NAME = 'definitions'
FUNCTIONS = common.FUNCTIONS
DEFINITIONS = common.DEFINITIONS
dotted = common.dotted


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


def extract(tree, text, path):
    return definitions_in(tree.body)
