"""Pydantic syntax only. Imports identify names, never load project objects."""
import ast

NAME = 'pydantic'
LIMITS = set('gt ge lt le multiple_of min_length max_length pattern max_digits decimal_places regex min_items max_items const'.split())
TYPES = {'conint': 'int', 'confloat': 'float', 'condecimal': 'float', 'constr': 'str',
         'conlist': 'list', 'conset': 'set', 'conbytes': 'bytes'}
META = {'Gt': 'gt', 'Ge': 'ge', 'Lt': 'lt', 'Le': 'le', 'MinLen': 'min_length',
        'MaxLen': 'max_length', 'MultipleOf': 'multiple_of'}


def literal(node):
    if isinstance(node, ast.Constant) and isinstance(node.value, (str, int, float, bool, type(None))):
        value = node.value
        if type(value) is int and abs(value) > 9007199254740991:
            return None
        return value if not isinstance(value, (int, float)) or abs(value) <= 1e308 else None
    if isinstance(node, ast.UnaryOp) and isinstance(node.op, (ast.USub, ast.UAdd)):
        value = literal(node.operand)
        if type(value) in (int, float):
            return -value if isinstance(node.op, ast.USub) else value
    return None


def aliases(tree):
    result = {}

    def bind(local, target):
        result[local] = target if local not in result or result[local] == target else '<ambiguous>'

    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for item in node.names:
                bind(item.asname or item.name.split('.')[0], item.name if item.asname else item.name.split('.')[0])
        if isinstance(node, ast.ImportFrom):
            for item in node.names:
                bind(item.asname or item.name, '.' * node.level + (node.module + '.' if node.module else '') + item.name)
    for node in ast.walk(tree):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            result.pop(node.name, None)
        elif isinstance(node, ast.arg):
            result.pop(node.arg, None)
        elif isinstance(node, ast.Name) and isinstance(node.ctx, (ast.Store, ast.Del)):
            result.pop(node.id, None)
    return result


def extract(tree, text, path):
    imported = aliases(tree)
    type_aliases = {node.targets[0].id: node.value for node in tree.body if isinstance(node, ast.Assign) and len(node.targets) == 1 and isinstance(node.targets[0], ast.Name) and isinstance(node.value, (ast.Call, ast.Subscript))}

    def name(node):
        raw = common.dotted(node)
        head, dot, tail = raw.partition('.')
        return imported.get(head, head) + (dot + tail if dot else '')

    def call_limits(node, field):
        target = name(node.func)
        short = target.split('.')[-1]
        trusted = target.startswith(('pydantic.', 'pydantic_settings.', 'annotated_types.'))
        if not trusted or not target.startswith('annotated_types.') and short not in set(TYPES) | {'Field'}:
            field['unknown'].append('custom-metadata:' + target)
            return
        if target.startswith('annotated_types.'):
            if short in META and node.args:
                add_limit(META[short], node.args[0], field)
            elif short == 'Len':
                for key, value in zip(('min_length', 'max_length'), node.args):
                    add_limit(key, value, field)
            elif short not in META and short != 'Interval':
                field['unknown'].append('metadata:' + short)
        for kw in node.keywords:
            key = kw.arg
            if short == 'Len':
                key = {'min_length': 'min_length', 'max_length': 'max_length'}.get(key, key)
            if key in LIMITS:
                add_limit(key, kw.value, field)
            elif key in ('alias', 'validation_alias'):
                field[key] = literal(kw.value)
                if not isinstance(field[key], str):
                    field['unknown'].append('dynamic-' + key)
            elif key not in ('default', 'description', 'title', 'examples', 'repr', 'frozen', 'strict'):
                field['unknown'].append('keyword:' + str(key))

    def add_limit(key, node, field):
        value = literal(node)
        if value is None:
            field['unknown'].append('not-literal:' + key)
        else:
            field['limits'].append({'check': key, 'limit': value})
        if key in ('regex', 'min_items', 'max_items', 'const'):
            field['versions'] = ['v1']

    def annotation(node, field):
        if isinstance(node, ast.Subscript):
            root = name(node.value)
            item = node.slice.value if isinstance(node.slice, ast.Index) else node.slice
            args = item.elts if isinstance(item, ast.Tuple) else [item]
            if root == 'typing.Optional':
                annotation(args[0], field)
            elif root in ('dict', 'typing.Dict'):
                field['type'] = 'object'
            elif root in ('typing.Annotated', 'typing_extensions.Annotated'):
                annotation(args[0], field)
                for meta in args[1:]:
                    if isinstance(meta, ast.Call):
                        call_limits(meta, field)
                    else:
                        field['unknown'].append('metadata:' + name(meta))
            elif root in ('typing.Literal', 'typing_extensions.Literal'):
                values = [literal(arg) for arg in args]
                if any(v is None and not (isinstance(arg, ast.Constant) and arg.value is None) for arg, v in zip(args, values)):
                    field['unknown'].append('non-literal-members')
                else:
                    field['members'] = values
                field['type'] = 'enum'
            elif root in ('list', 'set', 'tuple', 'typing.List', 'typing.Set', 'typing.Tuple'):
                field['type'] = 'array'
                # Item rules can reject a boundary value, even when the length is known.
                if any(name(arg) not in ('int', 'str', 'float', 'bool', 'bytes') for arg in args):
                    field['unknown'].append('item-type')
            else:
                field['unknown'].append('custom-type:' + root)
        elif isinstance(node, ast.Call) and name(node.func).startswith('pydantic.') and name(node.func).split('.')[-1] in TYPES:
            kind = TYPES[name(node.func).split('.')[-1]]
            field['type'] = 'number' if kind in ('int', 'float', 'decimal.Decimal') else 'string' if kind in ('str', 'bytes') else 'array'
            field['integer'] = kind == 'int'
            call_limits(node, field)
            if kind in ('list', 'set') and (not node.args or name(node.args[0]) not in ('int', 'str', 'float', 'bool', 'bytes')):
                field['unknown'].append('custom-item-type')
        else:
            kind = name(node)
            if isinstance(node, ast.Name) and node.id in type_aliases:
                alias = type_aliases[node.id]
                if isinstance(alias, ast.Call) and name(alias.func).startswith('pydantic.') and name(alias.func).split('.')[-1] in TYPES:
                    annotation(alias, field)
                    return
            field['annotation'] = kind
            field['type'] = 'number' if kind in ('int', 'float', 'decimal.Decimal') else 'string' if kind in ('str', 'bytes') else 'array' if kind in ('list', 'set', 'tuple') else 'boolean' if kind == 'bool' else 'object' if kind == 'dict' else 'unknown'
            field['integer'] = kind == 'int'
            if field['type'] == 'unknown':
                field['unknown'].append('custom-type:' + kind)

    classes, enums = [], {}
    for node in ast.walk(tree):
        if not isinstance(node, ast.ClassDef):
            continue
        bases = [name(base.value if isinstance(base, ast.Subscript) else base) if isinstance(base, (ast.Name, ast.Attribute, ast.Subscript)) else '<dynamic>' for base in node.bases]
        if any(base in ('enum.Enum', 'enum.IntEnum', 'enum.StrEnum') for base in bases):
            members = [stmt.value for stmt in node.body if isinstance(stmt, (ast.Assign, ast.AnnAssign))]
            values = [literal(member) for member in members]
            if values and all(value is not None or isinstance(member, ast.Constant) and member.value is None for member, value in zip(members, values)):
                enums[node.name] = values
        fields, validators, config, config_unknown = [], [], {}, []
        for stmt in node.body:
            inferred = False
            if isinstance(stmt, ast.Assign) and len(stmt.targets) == 1 and isinstance(stmt.targets[0], ast.Name) and isinstance(stmt.value, ast.Call) and name(stmt.value.func) in ('pydantic.Field', 'pydantic.v1.Field'):
                default = stmt.value.args[0] if stmt.value.args else next((k.value for k in stmt.value.keywords if k.arg == 'default'), None)
                value = literal(default)
                kind = 'str' if isinstance(value, str) else 'bool' if type(value) is bool else 'int' if type(value) is int else 'float' if type(value) is float else 'unknown'
                stmt = ast.copy_location(ast.AnnAssign(target=stmt.targets[0], annotation=ast.Name(id=kind, ctx=ast.Load()), value=stmt.value, simple=1), stmt)
                inferred = True
            if isinstance(stmt, ast.AnnAssign) and isinstance(stmt.target, ast.Name) and not stmt.target.id.startswith('_') and not (isinstance(stmt.annotation, ast.Subscript) and name(stmt.annotation.value) in ('typing.ClassVar', 'typing_extensions.ClassVar')):
                field = {'path': stmt.target.id, 'line': stmt.lineno, 'type': 'unknown', 'integer': False,
                         'annotation': '', 'limits': [], 'unknown': [], 'versions': [], 'members': [],
                         'alias': None, 'validation_alias': None}
                if inferred:
                    field['versions'] = ['v1']
                annotation(stmt.annotation, field)
                if isinstance(stmt.value, ast.Call):
                    call_limits(stmt.value, field)
                    if any(x['check'] == 'const' and x['limit'] is True for x in field['limits']):
                        default = stmt.value.args[0] if stmt.value.args else next((k.value for k in stmt.value.keywords if k.arg == 'default'), None)
                        value = literal(default)
                        if value is not None or isinstance(default, ast.Constant) and default.value is None:
                            field['members'] = [value]
                        else:
                            field['unknown'].append('non-literal-const')
                if field['path'] != 'model_config':
                    fields.append(field)
            if isinstance(stmt, (ast.FunctionDef, ast.AsyncFunctionDef)):
                for decorator in stmt.decorator_list:
                    target = decorator.func if isinstance(decorator, ast.Call) else decorator
                    if name(target).replace('pydantic.v1.', 'pydantic.') in ('pydantic.validator', 'pydantic.field_validator', 'pydantic.model_validator'):
                        selected = [literal(arg) for arg in decorator.args] if isinstance(decorator, ast.Call) else []
                        validators.append({'name': stmt.name, 'fields': selected if all(isinstance(x, str) for x in selected) else []})
            pairs = []
            targets = stmt.targets if isinstance(stmt, ast.Assign) else [stmt.target] if isinstance(stmt, ast.AnnAssign) else []
            if any(isinstance(t, ast.Name) and t.id == 'model_config' for t in targets):
                if isinstance(stmt.value, ast.Call) and name(stmt.value.func) in ('pydantic_settings.SettingsConfigDict', 'pydantic.ConfigDict'):
                    pairs = [(kw.arg, kw.value) for kw in stmt.value.keywords]
                elif isinstance(stmt.value, ast.Dict):
                    pairs = [(literal(k), v) for k, v in zip(stmt.value.keys, stmt.value.values)]
                else:
                    config_unknown.append('dynamic-config')
            if isinstance(stmt, ast.ClassDef) and stmt.name == 'Config':
                pairs = [(s.targets[0].id, s.value) for s in stmt.body if isinstance(s, ast.Assign) and isinstance(s.targets[0], ast.Name)]
            for key, value in pairs:
                if key is None or key in ('alias_generator', 'env_prefix_target', 'fields'):
                    config_unknown.append('unsupported-config:' + str(key))
                if key in ('env_prefix', 'case_sensitive', 'env_nested_delimiter'):
                    config[key] = literal(value)
                    if (key == 'case_sensitive' and not isinstance(config[key], bool)) or (key != 'case_sensitive' and not isinstance(config[key], str)):
                        config_unknown.append('dynamic-' + key)
        for base in node.bases:
            if isinstance(base, ast.Subscript) and name(base.value) == 'pydantic.RootModel' and not any(f['path'] == 'root' for f in fields):
                field = {'path': 'root', 'line': base.lineno, 'type': 'unknown', 'integer': False, 'annotation': '',
                         'limits': [], 'unknown': [], 'versions': [], 'members': [], 'alias': None, 'validation_alias': None}
                annotation(base.slice.value if isinstance(base.slice, ast.Index) else base.slice, field)
                fields.insert(0, field)
        classes.append({'name': node.name, 'line': node.lineno, 'bases': bases, 'nested': node not in tree.body,
                        'dataclass': any(name(d) == 'pydantic.dataclasses.dataclass' for d in node.decorator_list),
                        'fields': fields, 'validators': validators, 'config': config, 'configUnknown': config_unknown})
    return {'classes': classes, 'enums': enums, 'imports': imported,
            'imported': any(v.startswith(('pydantic.', 'pydantic_settings.')) or v in ('pydantic', 'pydantic_settings') for v in imported.values())}
