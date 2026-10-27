import assert from 'node:assert/strict';
import { collect, mapData } from '../lib/build.mjs';
import { defaults } from '../lib/project.mjs';
import { deriveFindings } from '../lib/findings.mjs';
import { fixture, pythonTest } from './python-fixtures.mjs';

const scan = (t, entries) => { const root = fixture(t, entries); return mapData(root, defaults, collect(root, defaults, { worktree: true }), 1, true).analysis; };
const orphans = (a) => deriveFindings(a).filter((f) => f.ruleId === 'FILE-ORPHANED').map((f) => f.location.path).sort();

pythonTest('Python entry points and orphaned modules share the package report', (t) => {
  const a = scan(t, { 'pyproject.toml': '[project]\ndependencies=[]\n[project.scripts]\nrun="pkg.cli:main"\n[project.gui-scripts]\ngui="pkg.gui:main"\n[project.entry-points.invented]\nplug="pkg.plugin"\n',
    'src/pkg/__init__.py': '', 'src/pkg/cli.py': 'from . import helper\n', 'src/pkg/helper.py': 'pass',
    'src/pkg/gui.py': 'pass', 'src/pkg/plugin.py': 'pass', 'src/pkg/__main__.py': 'pass',
    'src/pkg/guard.py': 'if __name__ == "__main__":\n pass\n', 'src/pkg/idle.py': 'pass' });
  assert.deepEqual(orphans(a), ['src/pkg/idle.py']);
});

for (const [path, text] of [
  ['pyproject.toml', '[tool.poetry.scripts]\nrun="pkg.cli:main"\n[tool.poetry.plugins.invented]\nplug="pkg.plugin"\n'],
  ['setup.cfg', '[options.entry_points]\nconsole_scripts =\n run = pkg.cli:main\ninvented =\n plug = pkg.plugin\n'],
  ['setup.py', 'setup(entry_points={"console_scripts": ["run = pkg.cli:main"], "invented": ["plug = pkg.plugin"]})\n'],
]) pythonTest(`Python entry declarations resolve ${path}`, (t) => {
  const a = scan(t, { [path]: text, 'src/pkg/cli.py': 'pass', 'src/pkg/plugin.py': 'pass', 'src/pkg/idle.py': 'pass' });
  assert.deepEqual(orphans(a), ['src/pkg/idle.py']);
});

pythonTest('workflow module starts and command paths protect Python entries', (t) => {
  const a = scan(t, { '.github/workflows/check.yml': 'steps:\n - run: python3 -m pkg.worker\n',
    'Makefile': 'run:\n\tpython src/pkg/task.py\n', 'Dockerfile': 'CMD ["python", "-m", "pkg.web"]\n',
    'tox.ini': '[testenv]\ncommands = pytest -p pkg.plugin\n', 'run.sh': 'uv run src/pkg/uvtask.py\n',
    'package.json': '{"scripts":{"start":"python -m pkg.npm"}}',
    'src/pkg/worker.py': 'pass', 'src/pkg/task.py': 'pass', 'src/pkg/web.py': 'pass', 'src/pkg/plugin.py': 'pass',
    'src/pkg/uvtask.py': 'pass', 'src/pkg/npm.py': 'pass', 'src/pkg/idle.py': 'pass' });
  assert.deepEqual(orphans(a), ['src/pkg/idle.py']);
});

pythonTest('Python named tool and framework files are entries', (t) => {
  const a = scan(t, { 'pyproject.toml': '[project]\ndependencies=["Django", "alembic"]\n',
    'conftest.py': 'pass', 'manage.py': 'pass', 'setup.py': 'pass', 'noxfile.py': 'pass', 'fabfile.py': 'pass',
    'wsgi.py': 'pass', 'asgi.py': 'pass', 'scripts/task.py': 'pass', 'bin/task.py': 'pass',
    'src/pkg/settings.py': 'pass', 'src/pkg/urls.py': 'pass', 'src/pkg/admin.py': 'pass', 'src/pkg/apps.py': 'pass',
    'src/pkg/models.py': 'pass', 'src/pkg/migrations/one.py': 'pass', 'alembic/env.py': 'pass', 'alembic/versions/one.py': 'pass', 'src/pkg/idle.py': 'pass' });
  assert.deepEqual(orphans(a), ['src/pkg/idle.py']);
});

pythonTest('computed imports with literal prefixes mark only reachable Python modules UNKNOWN', (t) => {
  const a = scan(t, { 'src/loader.py': 'import importlib\nimportlib.import_module("pkg.plugins." + name)\n',
    'src/pkg/plugins/one.py': 'pass', 'src/pkg/idle.py': 'pass' });
  assert.ok(a.packages.unknown.orphans.some((x) => x.path === 'src/pkg/plugins/one.py' && x.reason === 'dynamic-import'));
  assert.deepEqual(orphans(a), ['src/loader.py', 'src/pkg/idle.py']);
});

pythonTest('computed plugin loads and sys.path changes keep orphan reach UNKNOWN', (t) => {
  const a = scan(t, { 'src/loader.py': 'import sys\nfrom importlib.metadata import entry_points\nsys.path.insert(0, location)\nentry_points(group="invented")\n', 'src/pkg/one.py': 'pass' });
  assert.deepEqual(orphans(a), []);
  assert.ok(a.packages.unknown.orphans.some((x) => x.path === 'src/pkg/one.py'));
});

pythonTest('config module strings stay UNKNOWN rather than orphan findings', (t) => {
  const a = scan(t, { 'tox.ini': '[testenv]\ncustom = pkg.hidden\n', 'src/pkg/hidden.py': 'pass', 'src/pkg/idle.py': 'pass' });
  assert.deepEqual(orphans(a), ['src/pkg/idle.py']);
  assert.ok(a.packages.unknown.orphans.some((x) => x.path === 'src/pkg/hidden.py' && x.reason === 'config-reference'));
});

pythonTest('computed entry point declarations keep potential Python entry modules UNKNOWN', (t) => {
  const a = scan(t, { 'setup.py': 'setup(entry_points=make_entries())\n', 'src/pkg/cli.py': 'pass' });
  assert.deepEqual(orphans(a), []);
  assert.ok(a.packages.unknown.orphans.some((u) => u.reason === 'entry-not-mapped'));
});

pythonTest('relative dynamic import prefixes protect the containing Python package', (t) => {
  const a = scan(t, { 'src/pkg/loader.py': 'import importlib\nimportlib.import_module(".plugins." + name, __package__)\n', 'src/pkg/plugins/one.py': 'pass', 'src/idle.py': 'pass' });
  assert.ok(a.packages.unknown.orphans.some((u) => u.path === 'src/pkg/plugins/one.py'));
  assert.deepEqual(orphans(a), ['src/idle.py', 'src/pkg/loader.py']);
});

pythonTest('unresolved Python command working directories keep matching file targets UNKNOWN', (t) => {
  const a = scan(t, { 'run.sh': 'cd src/pkg\npython worker.py\n', 'src/pkg/worker.py': 'pass', 'src/pkg/idle.py': 'pass' });
  assert.deepEqual(orphans(a), ['src/pkg/idle.py']);
  assert.ok(a.packages.unknown.orphans.some((u) => u.path === 'src/pkg/worker.py' && u.reason === 'entry-not-mapped'));
});

pythonTest('conftest plugin module strings keep local Python plugin reach UNKNOWN', (t) => {
  const a = scan(t, { 'conftest.py': 'pytest_plugins = ["pkg.plugin"]\n', 'src/pkg/plugin.py': 'pass', 'src/pkg/idle.py': 'pass' });
  assert.deepEqual(orphans(a), ['src/pkg/idle.py']);
  assert.ok(a.packages.unknown.orphans.some((u) => u.path === 'src/pkg/plugin.py'));
});

pythonTest('file-based importlib loaders keep Python module reach UNKNOWN', (t) => {
  const a = scan(t, { 'loader.py': 'import importlib.util\nspec = importlib.util.spec_from_file_location(name, path)\nspec.loader.exec_module(module)\n', 'pkg/one.py': 'pass' });
  assert.deepEqual(orphans(a), []);
  assert.ok(a.packages.unknown.orphans.some((u) => u.path === 'pkg/one.py'));
});

pythonTest('framework imports protect Django files without dependency declarations', (t) => {
  const a = scan(t, { 'manage.py': 'import django\n', 'src/pkg/models.py': 'pass', 'src/pkg/settings.py': 'pass', 'src/pkg/migrations/one.py': 'pass', 'src/pkg/idle.py': 'pass' });
  assert.deepEqual(orphans(a), ['src/pkg/idle.py']);
});

pythonTest('aliased literal importlib calls keep matching Python modules UNKNOWN', (t) => {
  const a = scan(t, { 'src/loader.py': 'from importlib import import_module as load\nload("pkg.plugin")\n', 'src/pkg/plugin.py': 'pass', 'src/pkg/idle.py': 'pass' });
  assert.deepEqual(orphans(a), ['src/loader.py', 'src/pkg/idle.py']);
  assert.ok(a.packages.unknown.orphans.some((u) => u.path === 'src/pkg/plugin.py' && u.reason === 'dynamic-import'));
});

pythonTest('Django settings module strings in manage files keep their target UNKNOWN', (t) => {
  const a = scan(t, { 'manage.py': 'import django\nimport os\nos.environ.setdefault("DJANGO_SETTINGS_MODULE", "pkg.settings.dev")\n', 'src/pkg/settings/dev.py': 'pass', 'src/pkg/idle.py': 'pass' });
  assert.deepEqual(orphans(a), ['src/pkg/idle.py']);
  assert.ok(a.packages.unknown.orphans.some((u) => u.path === 'src/pkg/settings/dev.py' && u.reason === 'config-reference'));
});

for (const [path, text] of [
  ['setup.py', 'setup(**configuration)\n'],
  ['pyproject.toml', '[project]\ndynamic=["scripts", "entry-points"]\n'],
]) pythonTest(`dynamic entry declarations stay UNKNOWN in ${path}`, (t) => {
  const a = scan(t, { [path]: text, 'src/pkg/cli.py': 'pass' });
  assert.deepEqual(orphans(a), []);
  assert.ok(a.packages.unknown.orphans.some((u) => u.reason === 'entry-not-mapped'));
});

pythonTest('orphan metadata uses the nearest declaring project rather than the first manifest', (t) => {
  const a = scan(t, { 'pyproject.toml': '[project]\ndependencies=[]\n', 'nested/requirements.txt': 'invented-core\n', 'src/idle.py': 'pass', 'nested/idle.py': 'pass' });
  assert.equal(a.packages.leads.orphaned.find((u) => u.path === 'src/idle.py').manifest, 'pyproject.toml');
  assert.equal(a.packages.leads.orphaned.find((u) => u.path === 'nested/idle.py').manifest, 'nested/requirements.txt');
});
