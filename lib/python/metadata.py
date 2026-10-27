"""Read packaging text only. Input is bounded by the caller. No project imports."""
import ast
import configparser
import json
import re
import sys


def literal_toml(value):
    # JSON strings and TOML literal strings share the needed packaging subset.
    tokens = re.findall(r'"(?:\\.|[^"\\])*"|\'[^\']*\'|[A-Za-z0-9_.+-]+|[\[\]{},=:]|[^\s]', value)
    at = [0]
    def take(depth=0):
        if depth > 32 or at[0] >= len(tokens):
            raise ValueError('TOML literal limit or incomplete value')
        token = tokens[at[0]]
        at[0] += 1
        if token in ('[', '{'):
            close = ']' if token == '[' else '}'
            output = [] if token == '[' else {}
            while at[0] < len(tokens) and tokens[at[0]] != close:
                item = take(depth + 1)
                if token == '{':
                    if not isinstance(item, str) or at[0] >= len(tokens) or tokens[at[0]] != '=':
                        raise ValueError('invalid inline table')
                    at[0] += 1
                    output[item] = take(depth + 1)
                else:
                    output.append(item)
                if at[0] < len(tokens) and tokens[at[0]] == ',':
                    at[0] += 1
                elif at[0] >= len(tokens) or tokens[at[0]] != close:
                    raise ValueError('invalid literal separator')
            if at[0] >= len(tokens):
                raise ValueError('incomplete literal')
            at[0] += 1
            return output
        if token.startswith('"'):
            return json.loads(token)
        if token.startswith("'"):
            return token[1:-1]
        if token in (']', '}', ',', '=', ':'):
            raise ValueError('invalid literal')
        return token
    result = take()
    if at[0] != len(tokens):
        raise ValueError('unsupported TOML value')
    return result


def fallback_toml(text):
    """Bounded subset. Unsupported TOML stays UNKNOWN instead of guessing."""
    root, section, pending = {}, [], ''
    for raw in text.splitlines():
        # Remove comments outside quotes only.
        line = re.sub(r'("(?:\\.|[^"\\])*"|\'[^\']*\')|#.*', lambda m: m.group(1) or '', raw).strip()
        if not line:
            continue
        if not pending and line.startswith('[') and line.endswith(']'):
            if line.startswith('[['):
                raise ValueError('array tables need tomllib')
            section = [s.strip(' "\'') for s in line[1:-1].split('.')]
            continue
        pending += line
        if pending.count('[') != pending.count(']') or pending.count('{') != pending.count('}'):
            continue
        if '=' not in pending:
            raise ValueError('invalid TOML key')
        key, value = pending.split('=', 1)
        current = root
        for part in section:
            current = current.setdefault(part, {})
        current[key.strip(' "\'')] = literal_toml(value.strip())
        pending = ''
    if pending:
        raise ValueError('incomplete TOML literal')
    return root


def read_toml(text):
    try:
        import tomllib
    except ImportError:
        return fallback_toml(text)
    return tomllib.loads(text)


def parse(path, text, toml_reader=read_toml):
    result = {'dependencies': [], 'entries': [], 'unknown': [], 'locked': [], 'declares': False, 'references': []}
    def unknown(reason):
        result['unknown'].append(reason)
    def add(value, group='main'):
        result['declares'] = True
        if isinstance(value, list) and all(isinstance(v, str) for v in value):
            result['dependencies'].extend({'value': v, 'group': group} for v in value)
        else:
            unknown('computed or unsupported dependency declaration')
    def references(value, depth=0):
        if depth > 32:
            unknown('configuration reference depth limit')
        elif isinstance(value, str):
            result['references'].append(value)
        elif isinstance(value, dict):
            for key, child in value.items():
                result['references'].append(key)
                references(child, depth + 1)
        elif isinstance(value, list):
            for child in value:
                references(child, depth + 1)
    def mapping(value, group='main'):
        if not isinstance(value, dict):
            unknown('unsupported dependency mapping')
            return
        for name, spec in value.items():
            if name != 'python':
                optional = isinstance(spec, dict) and spec.get('optional') in (True, 'true')
                add([name], 'optional' if optional else group)
    def entries(value, group='scripts'):
        if isinstance(value, dict):
            for name, target in value.items():
                if isinstance(target, str):
                    result['entries'].append({'target': target, 'group': group})
                elif isinstance(target, dict) and isinstance(target.get('reference'), str):
                    result['entries'].append({'target': target['reference'], 'group': group})
                else:
                    unknown('computed or unsupported entry point')
        elif isinstance(value, list) and all(isinstance(v, str) for v in value):
            for target in value:
                result['entries'].append({'target': target.split('=', 1)[-1].strip(), 'group': group})
        else:
            unknown('computed or unsupported entry point')
    if path.endswith('setup.py'):
        tree = ast.parse(text)
        for node in ast.walk(tree):
            if not isinstance(node, ast.Call) or not (isinstance(node.func, ast.Name) and node.func.id == 'setup'
                    or isinstance(node.func, ast.Attribute) and node.func.attr == 'setup'):
                continue
            for keyword in node.keywords:
                if keyword.arg not in ('install_requires', 'extras_require', 'tests_require', 'entry_points'):
                    if keyword.arg is None:
                        unknown('computed setup keyword arguments')
                    continue
                try:
                    value = ast.literal_eval(keyword.value)
                except (ValueError, TypeError, SyntaxError):
                    unknown('computed setup ' + keyword.arg)
                    continue
                if keyword.arg == 'install_requires':
                    add(value)
                elif keyword.arg == 'tests_require':
                    add(value, 'development')
                elif isinstance(value, dict):
                    for group, items in value.items():
                        if keyword.arg == 'entry_points':
                            entries(items, group)
                        else:
                            add(items, 'optional')
                else:
                    unknown('unsupported setup ' + keyword.arg)
    elif path.endswith('setup.cfg'):
        config = configparser.ConfigParser(interpolation=None, strict=False)
        config.read_string(text)
        if config.has_option('options', 'install_requires'):
            add([v.strip() for v in config.get('options', 'install_requires').splitlines() if v.strip()])
        if config.has_section('options.extras_require'):
            for _, value in config.items('options.extras_require'):
                add([v.strip() for v in value.splitlines() if v.strip()], 'optional')
        if config.has_section('options.entry_points'):
            for group, value in config.items('options.entry_points'):
                entries([v.strip() for v in value.splitlines() if v.strip()], group)
    elif path.endswith('Pipfile.lock'):
        data = json.loads(text)
        for group in ('default', 'develop'):
            result['locked'].extend(data.get(group, {}).keys())
    elif path.endswith(('uv.lock', 'poetry.lock')):
        # Lock files supply names only, never declarations or entry points.
        result['locked'] = re.findall(r'^name\s*=\s*["\']([^"\']+)["\']', text, re.M)
    else:
        data = toml_reader(text)
        if path.endswith('Pipfile'):
            for group in ('packages', 'dev-packages'):
                if group in data:
                    mapping(data[group], 'main' if group == 'packages' else 'development')
        else:
            project = data.get('project', {})
            if 'dependencies' in project:
                add(project['dependencies'])
            dynamic = project.get('dynamic', [])
            if not isinstance(dynamic, list) or not all(isinstance(v, str) for v in dynamic):
                unknown('invalid dynamic project metadata')
            else:
                if 'dependencies' in dynamic:
                    unknown('computed project dependencies')
                if any(v in dynamic for v in ('scripts', 'gui-scripts', 'entry-points')):
                    unknown('computed project entry points')
            for values in project.get('optional-dependencies', {}).values():
                add(values, 'optional')
            groups = data.get('dependency-groups', {})
            for values in groups.values():
                if not isinstance(values, list):
                    unknown('unsupported dependency group')
                    continue
                add([v for v in values if isinstance(v, str)], 'development')
                for value in values:
                    if isinstance(value, str):
                        continue
                    if not isinstance(value, dict) or set(value) != {'include-group'} or not isinstance(value.get('include-group'), str):
                        unknown('invalid dependency group member')
                    elif value['include-group'] not in groups:
                        unknown('unresolved dependency group include')
            tool = data.get('tool', {})
            poetry = tool.get('poetry', {})
            if 'dependencies' in poetry:
                mapping(poetry['dependencies'])
            if 'dev-dependencies' in poetry:
                mapping(poetry['dev-dependencies'], 'development')
            for group in poetry.get('group', {}).values():
                mapping(group.get('dependencies', {}), 'development')
            if 'dev-dependencies' in tool.get('uv', {}):
                add(tool['uv']['dev-dependencies'], 'development')
            for group in ('scripts', 'gui-scripts'):
                if group in project:
                    entries(project[group], group)
            for group, values in project.get('entry-points', {}).items():
                entries(values, group)
            if 'scripts' in poetry:
                entries(poetry['scripts'])
            for group, values in poetry.get('plugins', {}).items():
                entries(values, group)
            # Dependency declarations do not count as their own configuration use.
            project_config = {k: v for k, v in project.items() if k not in ('dependencies', 'optional-dependencies')}
            poetry_config = {k: v for k, v in poetry.items() if k not in ('dependencies', 'dev-dependencies', 'group')}
            uv_config = {k: v for k, v in tool.get('uv', {}).items() if k != 'dev-dependencies'}
            other_tools = {k: v for k, v in tool.items() if k not in ('poetry', 'uv')}
            references([project_config, poetry_config, uv_config, other_tools, data.get('build-system', {})])
    return result


if __name__ == '__main__':
    output = []
    for item in json.loads(sys.stdin.buffer.read().decode('utf-8')):
        try:
            output.append({'path': item['path'], **parse(item['path'], item['text'])})
        except (ValueError, TypeError, AttributeError, SyntaxError, configparser.Error, RecursionError) as error:
            output.append({'path': item['path'], 'dependencies': [], 'entries': [], 'locked': [],
                           'declares': False, 'references': [], 'unknown': ['invalid packaging text: ' + type(error).__name__]})
    print(json.dumps(output))
