"""Generate AST edits or parse mutant text. Never execute supplied code."""
import ast
import io
import json
import sys
import tokenize


def generate(item):
    text = item['text']
    tree = ast.parse(text, filename=item['path'])
    lines = io.StringIO(text, newline='').readlines()
    starts = [0]
    for line in lines:
        starts.append(starts[-1] + len(line))
    changed = set(item['lines'])
    tokens = list(tokenize.generate_tokens(iter(lines).__next__))
    edits = []

    def index(line, byte_column):
        prefix = lines[line - 1].encode('utf-8')[:byte_column].decode('utf-8')
        return starts[line - 1] + len(prefix)

    def bounds(node):
        return index(node.lineno, node.col_offset), index(node.end_lineno, node.end_col_offset)

    def position(offset):
        for number in range(len(lines) - 1, -1, -1):
            if starts[number] <= offset:
                column = len(text[starts[number]:offset].encode('utf-16-le')) // 2
                return {'line': number + 1, 'column': column}

    def add(start, end, replacement, name):
        location = {'start': position(start), 'end': position(end)}
        if location['start']['line'] not in changed or text[start:end] == replacement:
            return
        edits.append({'path': item['path'], 'start': len(text[:start].encode('utf-16-le')) // 2,
                      'end': len(text[:end].encode('utf-16-le')) // 2, 'original': text[start:end],
                      'replacement': replacement, 'mutatorName': name, 'location': location})

    def operator(left, right, words, replacement, name):
        lower, upper = bounds(left)[1], bounds(right)[0]
        found = []
        for token in tokens:
            start = starts[token.start[0] - 1] + token.start[1]
            end = starts[token.end[0] - 1] + token.end[1]
            if lower <= start < end <= upper and token.string in words:
                found.append((start, end, token.string))
        if [entry[2] for entry in found] == words:
            add(found[0][0], found[-1][1], replacement, name)

    comparisons = {ast.Lt: ('<', '<='), ast.LtE: ('<=', '<'), ast.Gt: ('>', '>='),
                   ast.GtE: ('>=', '>'), ast.Eq: ('==', '!='), ast.NotEq: ('!=', '=='),
                   ast.Is: ('is', 'is not'), ast.IsNot: ('is not', 'is'),
                   ast.In: ('in', 'not in'), ast.NotIn: ('not in', 'in')}

    def allows_none(annotation):
        if isinstance(annotation, ast.Constant):
            return annotation.value is None
        if isinstance(annotation, ast.BinOp) and isinstance(annotation.op, ast.BitOr):
            return allows_none(annotation.left) or allows_none(annotation.right)
        if isinstance(annotation, ast.Subscript):
            name = annotation.value
            name = name.id if isinstance(name, ast.Name) else name.attr if isinstance(name, ast.Attribute) else ''
            if name == 'Optional':
                return True
            values = annotation.slice
            if hasattr(ast, 'Index') and isinstance(values, ast.Index):
                values = values.value
            return name == 'Union' and isinstance(values, ast.Tuple) and any(allows_none(v) for v in values.elts)
        return False

    def visit(node, optional=False):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            for expression in node.decorator_list + node.args.defaults + [value for value in node.args.kw_defaults if value is not None]:
                visit(expression)
            for statement in node.body:
                visit(statement, allows_none(node.returns))
            return
        if isinstance(node, ast.Lambda):
            optional = False
        if isinstance(node, ast.Compare):
            values = [node.left] + node.comparators
            for i, op in enumerate(node.ops):
                words, replacement = comparisons[type(op)]
                operator(values[i], values[i + 1], words.split(), replacement, 'Comparison')
        if isinstance(node, ast.BoolOp) and isinstance(node.op, ast.And):
            for left, right in zip(node.values, node.values[1:]):
                operator(left, right, ['and'], 'or', 'LogicalOperator')
        if isinstance(node, ast.BinOp) and isinstance(node.op, ast.Add):
            numeric = lambda value: isinstance(value, ast.Constant) and type(value.value) in (int, float, complex)
            if numeric(node.left) and numeric(node.right):
                operator(node.left, node.right, ['+'], '-', 'ArithmeticOperator')
        if isinstance(node, ast.Constant) and type(node.value) is bool:
            add(*bounds(node), 'False' if node.value else 'True', 'BooleanLiteral')
        if isinstance(node, ast.UnaryOp) and isinstance(node.op, ast.Not):
            start, end = bounds(node.operand)
            add(*bounds(node), text[start:end], 'UnaryNot')
        if isinstance(node, ast.Return) and node.value is not None and optional:
            add(*bounds(node.value), 'None', 'ReturnNone')
        for child in ast.iter_child_nodes(node):
            visit(child, optional)

    visit(tree)
    return sorted(edits, key=lambda edit: (edit['start'], edit['end'], edit['mutatorName']))


item = json.loads(sys.stdin.buffer.read().decode('utf-8'))
try:
    if item['mode'] == 'compile':
        ast.parse(item['text'], filename=item['path'])
        result = {'ok': True}
    else:
        result = {'ok': True, 'edits': generate(item)}
except (SyntaxError, ValueError, RecursionError, tokenize.TokenError) as error:
    result = {'ok': False, 'error': str(error)}
print(json.dumps(result))
