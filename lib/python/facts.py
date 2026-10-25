"""Parse supplied text only. Never import or execute a project module."""
# EXTRACTORS run in tuple order with extract(tree, text, path).
# NAME selects one output key. NAME = None merges a dictionary of output keys.
# Each extractor receives the shipped common module through the file loader.
import ast
import configparser
import importlib.util
import json
import os
import sys


FOLDER = os.path.dirname(os.path.abspath(__file__))


def load(name, shared=None):
    path = os.path.join(FOLDER, 'extractors', name + '.py')
    spec = importlib.util.spec_from_file_location('code_map_' + name, path)
    module = importlib.util.module_from_spec(spec)
    module.common = shared
    spec.loader.exec_module(module)
    return module


common = load('common')
common.failure_values = load('failure_values', common)
EXTRACTORS = tuple(load(name, common) for name in ('imports', 'definitions', 'names', 'tests', 'failure_paths', 'package_sites', 'public_api', 'api_calls', 'models', 'settings'))


def facts(item):
    text, errors = item['text'], []
    try:
        tree = ast.parse(text, filename=item['path'])
    except (SyntaxError, ValueError, RecursionError) as error:
        errors = [{'line': getattr(error, 'lineno', 1) or 1, 'message': str(error)}]
        text = ''
        tree = ast.Module(body=[], type_ignores=[])
    result = {'path': item['path']}
    for extractor in EXTRACTORS:
        value = extractor.extract(tree, text, item['path'])
        if extractor.NAME is None:
            result.update(value)
        else:
            result[extractor.NAME] = value
    result['errors'] = errors
    return result


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
texts = {item['path']: item['text'] for item in payload if not item['path'].endswith(('.py', '.pyi'))}
print(json.dumps({'files': [facts(item) for item in payload if item['path'].endswith(('.py', '.pyi'))],
                  'stdlib': sorted(getattr(sys, 'stdlib_module_names', common.STDLIB)),
                  'config': configuration(texts)}))
