"""Failure values in Python assertions, using the shared TypeScript kind names."""
import ast

ERRORS = {'err', 'error', 'errors', 'exception', 'failure', 'failures', 'issues', 'stderr'}
FLAGS = {'ok', 'success', 'succeeded', 'valid', 'isValid', 'passed', 'allowed', 'accepted'}
STATUSES = {'status', 'statusCode', 'status_code', 'code', 'exitCode', 'exit_code'}


def index(node):
    value = node.slice
    return value.value if isinstance(value, ast.Index) else value


def names(node):
    if isinstance(node, ast.Name):
        return [node.id]
    if isinstance(node, ast.Attribute):
        return names(node.value) + [node.attr]
    if isinstance(node, ast.Subscript):
        key = index(node)
        return names(node.value) + ([key.value] if isinstance(key, ast.Constant) and isinstance(key.value, str) else [])
    if isinstance(node, ast.Call):
        return names(node.func)
    return []


def literal(node):
    if isinstance(node, ast.Constant):
        return True, node.value
    if isinstance(node, (ast.List, ast.Tuple, ast.Dict, ast.Set)) and not list(ast.iter_child_nodes(node)):
        return True, []
    return False, None


def check(node):
    subject, expected, present, inverted = node, None, True, False
    if isinstance(node, ast.UnaryOp) and isinstance(node.op, ast.Not):
        subject, present = node.operand, False
    elif isinstance(node, ast.Compare) and len(node.ops) == 1:
        left, right, op = node.left, node.comparators[0], node.ops[0]
        if isinstance(op, (ast.In, ast.NotIn)):
            subject, expected, present = right, left, isinstance(op, ast.In)
        elif isinstance(op, (ast.Eq, ast.Is, ast.NotEq, ast.IsNot)):
            if literal(left)[0] and not literal(right)[0]:
                left, right = right, left
            subject, expected, inverted = left, right, isinstance(op, (ast.NotEq, ast.IsNot))
            known, value = literal(expected)
            if not known:
                return None
            empty = value is None or value is False or value == 0 or value == '' or value == []
            present = empty if inverted else not empty
        else:
            return None
    path = names(subject)
    last = path[-1] if path else ''
    known, value = literal(expected)
    if last in FLAGS:
        failed = (value is False and not inverted or value is True and inverted) if known else not present
        return ('ok-false', subject, expected) if failed else None
    if last in STATUSES and known and isinstance(value, (int, float)) and not isinstance(value, bool):
        bad = value >= 400 or 0 < value < 100
        return ('status', subject, expected) if bad != inverted else None
    if present and any(name in ERRORS for name in path):
        return 'error-value', subject, expected
    return None
