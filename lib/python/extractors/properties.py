"""Hypothesis source evidence only. Never import Hypothesis or project modules."""
import ast
import math

NAME = 'properties'


def extract(tree, text, path):
    bindings = {}
    for node in tree.body:
        if isinstance(node, ast.Import):
            for alias in node.names:
                if alias.name == 'hypothesis' or alias.name.startswith('hypothesis.'):
                    bindings[alias.asname or alias.name.split('.')[0]] = alias.name if alias.asname else 'hypothesis'
        elif isinstance(node, ast.ImportFrom) and node.level == 0 and (node.module or '').startswith('hypothesis'):
            for alias in node.names:
                bindings[alias.asname or alias.name] = node.module + '.' + alias.name

    # A reassigned import no longer proves that its decorators come from Hypothesis.
    for node in tree.body:
        targets = node.targets if isinstance(node, ast.Assign) else [node.target] if isinstance(node, (ast.AnnAssign, ast.AugAssign)) else []
        for target in targets:
            if isinstance(target, ast.Name):
                bindings.pop(target.id, None)
        if isinstance(node, common.DEFINITIONS):
            bindings.pop(node.name, None)

    def name(node):
        parts = common.dotted(node).split('.')
        return '.'.join([bindings.get(parts[0], ''), *parts[1:]])

    def source(node):
        return (ast.get_source_segment(text, node) or '')[:8192]

    def fact(node):
        try:
            value = ast.literal_eval(node)
            if isinstance(value, int) and abs(value) > 9007199254740991:
                return {'state': 'literal', 'value': str(value), 'integerText': True, 'source': source(node)}
            if (value is None or isinstance(value, (bool, int, str)) or isinstance(value, float) and math.isfinite(value)):
                return {'state': 'literal', 'value': value, 'source': source(node)}
        except (ValueError, TypeError, RecursionError):
            pass
        if isinstance(node, (ast.Tuple, ast.List)) and all(name(n) in ('hypothesis.Phase.explicit', 'hypothesis.Phase.reuse', 'hypothesis.Phase.generate', 'hypothesis.Phase.target', 'hypothesis.Phase.shrink', 'hypothesis.Phase.explain') for n in node.elts):
            return {'state': 'literal', 'value': [name(n).split('.')[-1] for n in node.elts], 'source': source(node)}
        return {'state': 'UNKNOWN', 'reason': 'Computed or non-literal setting.', 'source': source(node)}

    def settings(call):
        result = {k.arg: fact(k.value) for k in call.keywords if k.arg}
        if call.args or any(k.arg in (None, 'parent') for k in call.keywords):
            result['_unknown'] = {'state': 'UNKNOWN', 'reason': 'Computed settings or settings parent.', 'source': source(call)}
        return result

    def describe(node, kind='given', rules=None):
        result = {'name': node.name, 'line': node.lineno, 'suite': '', 'kind': kind, 'settings': {}, 'generators': [], 'examples': [], 'seed': None, 'rules': rules or [], 'invariant': source(node), 'assertions': sum(isinstance(n, ast.Assert) for n in ast.walk(node))}
        for decorator in node.decorator_list:
            if not isinstance(decorator, ast.Call):
                continue
            target = name(decorator.func)
            if target == 'hypothesis.settings':
                result['settings'].update(settings(decorator))
            elif target == 'hypothesis.seed':
                result['seed'] = fact(decorator.args[0]) if len(decorator.args) == 1 else {'state': 'UNKNOWN', 'reason': 'Seed is not one literal.'}
            elif target == 'hypothesis.given':
                result['generators'] = [{'argument': str(i), 'source': source(n)} for i, n in enumerate(decorator.args)] + [{'argument': k.arg or '**', 'source': source(k.value)} for k in decorator.keywords]
            elif target == 'hypothesis.example':
                result['examples'].append(source(decorator))
        return result

    tests, profiles, loads = [], [], []
    for node in tree.body:
        if isinstance(node, ast.Expr) and isinstance(node.value, ast.Call):
            call, target = node.value, name(node.value.func)
            if target == 'hypothesis.settings.register_profile':
                profiles.append({'name': fact(call.args[0]) if call.args else {'state': 'UNKNOWN', 'reason': 'Missing profile name.'}, 'settings': settings(call)})
                # The first positional argument is the profile name, not a settings parent.
                if len(call.args) == 1 and all(k.arg not in (None, 'parent') for k in call.keywords):
                    profiles[-1]['settings'].pop('_unknown', None)
            elif target == 'hypothesis.settings.load_profile':
                loads.append(fact(call.args[0]) if len(call.args) == 1 else {'state': 'UNKNOWN', 'reason': 'Computed profile load.'})
        if isinstance(node, common.FUNCTIONS) and any(name(d) == 'hypothesis.given' for d in node.decorator_list):
            tests.append(describe(node))
        elif isinstance(node, ast.ClassDef):
            if any(name(b) == 'hypothesis.stateful.RuleBasedStateMachine' for b in node.bases):
                rules = [{'name': m.name, 'source': source(d), 'line': m.lineno} for m in node.body if isinstance(m, common.FUNCTIONS) for d in m.decorator_list if name(d) in ('hypothesis.stateful.rule', 'hypothesis.stateful.invariant', 'hypothesis.stateful.initialize')]
                for assignment in tree.body:
                    if isinstance(assignment, ast.Assign) and isinstance(assignment.value, ast.Attribute) and common.dotted(assignment.value) == node.name + '.TestCase':
                        for target in assignment.targets:
                            if isinstance(target, ast.Name):
                                item = describe(node, 'stateful', rules)
                                item['name'], item['suite'] = 'runTest', target.id
                                tests.append(item)
            else:
                for method in node.body:
                    if isinstance(method, common.FUNCTIONS) and any(name(d) == 'hypothesis.given' for d in method.decorator_list):
                        item = describe(method)
                        item['suite'] = node.name
                        tests.append(item)
    top_calls = {id(node.value) for node in tree.body if isinstance(node, ast.Expr) and isinstance(node.value, ast.Call)}
    for node in ast.walk(tree):
        if isinstance(node, ast.Call) and id(node) not in top_calls and name(node.func) == 'hypothesis.settings.load_profile':
            loads.append({'state': 'UNKNOWN', 'reason': 'Conditional or nested profile load.', 'source': source(node)})
    return {'tests': tests, 'profiles': profiles, 'loads': loads}
