import assert from 'node:assert/strict';
import { collectPython } from '../lib/python/collect.mjs';
import { findInterpreter } from '../lib/python/interpreter.mjs';
import { parsePython } from '../lib/python/parse.mjs';
import { apiSurface } from '../lib/api-surface.mjs';
import { compareApi, surfaces } from '../lib/api-compare.mjs';
import { callSites } from '../lib/impact/calls.mjs';
import { analyzeProject } from '../lib/analysis.mjs';
import { deriveFindings } from '../lib/findings.mjs';
import { fixture, pythonTest } from './python-fixtures.mjs';

const parse = (text) => parsePython(findInterpreter().interpreter, [{ path: 'orchard.py', text }]).files[0];
function snapshot(t, entries) {
  const root = fixture(t, entries), texts = new Map(Object.entries(entries));
  const facts = collectPython([...texts.keys()], texts, {}, (paths) => new Map(paths.filter((p) => texts.has(p)).map((p) => [p, texts.get(p)])), root);
  const api = apiSurface(facts.files, facts.testFacts);
  return { data: { analysis: { files: facts.files.map((f) => ({ ...f, imports: f.edges })), api } }, facts, texts };
}
const compare = (a, b, options = {}) => compareApi(a, b, { state: 'COMPARABLE', ...options });

pythonTest('Python public names distinguish literal extended computed and implicit exports', (t) => {
  const { facts } = snapshot(t, {
    'orchard.py': `from basket import hidden\nfrom basket import kept as kept\nimport grove as grove\n_private = 1\nfruit = 1\ndef pick(): pass\nclass Tree:\n def grow(self): pass\n`,
    'literal.py': `from orchard import pick\n__all__ = ['pick']\n__all__ += ('fruit',)\n__all__.extend(['missing'])\nfruit = 1\ndef secret(): pass\n`,
    'computed.py': `__all__ = discover()\ndef uncertain(): pass\n`,
  });
  const by = new Map(facts.files.map((f) => [f.path, f]));
  assert.deepEqual(by.get('orchard.py').exports, ['Tree', 'fruit', 'grove', 'kept', 'pick']);
  assert.deepEqual(by.get('literal.py').exports, ['fruit', 'pick']);
  assert.deepEqual(by.get('literal.py').python.publicApi.unknownNames, ['missing']);
  assert.equal(by.get('computed.py').python.publicApi.state, 'UNKNOWN');
  assert.deepEqual(by.get('computed.py').exports, []);
  assert.equal(by.get('orchard.py').declarations.find((d) => d.name === 'Tree').children[0].exported, false);
});

pythonTest('Python public annotations stubs overloads and class fields retain call forms', (t) => {
  const { facts } = snapshot(t, {
    'orchard.py': 'def pick(wrong): pass\n',
    'orchard.pyi': 'from typing import overload\n@overload\ndef pick(x: int, /) -> int: ...\n@overload\ndef pick(x: str, /) -> str: ...\n',
    'grove.py': `from dataclasses import dataclass\n@dataclass(frozen=True, kw_only=True)\nclass Tree:\n height: int = 2\n @classmethod\n async def grow(cls, x: int, /, y: str = 'a', *args, z: bool, **kwargs) -> str: pass\n`,
  });
  const record = facts.files.find((f) => f.path === 'orchard.py').signatures[0];
  assert.equal(record.signatureSource, 'orchard.pyi');
  assert.equal(record.overloads, 2);
  const shape = facts.files.find((f) => f.path === 'grove.py').signatures.find((s) => s.name === 'Tree').python;
  assert.equal(shape.fields[0].annotation, 'int');
  assert.equal(shape.methods.grow[0].async, true);
  assert.deepEqual(shape.methods.grow[0].parameters.map((p) => p.kind), ['positional-only', 'positional-only', 'positional-or-keyword', 'var-positional', 'keyword-only', 'var-keyword']);
});

pythonTest('Python removed exports follow package reexports and Git renames', (t) => {
  const base = snapshot(t, { 'grove/__init__.py': "from .core import pick\n__all__ = ['pick']\n", 'grove/core.py': 'def pick(x: int) -> int: return x\n', 'user.py': 'from grove import pick\npick(1)\n' });
  const head = snapshot(t, { 'grove/__init__.py': "from .core import pick\n__all__ = ['pick']\n", 'grove/core.py': '', 'user.py': 'from grove import pick\npick(1)\n' });
  const result = compare(base, head);
  assert.equal(result.items.find((i) => i.path === 'grove/core.py' && i.name === 'pick').status, 'REMOVED');
  assert.ok(result.items.find((i) => i.path === 'grove/core.py').consumers.items.some((c) => c.path === 'user.py'));
  assert.equal(surfaces(base.data.analysis.api.files)('grove/__init__.py').get('pick').declaredIn, 'grove/core.py');
  const moved = snapshot(t, { 'new.py': 'def pick(x: int, needed: str) -> int: return x\n' });
  const original = snapshot(t, { 'old.py': 'def pick(x: int) -> int: return x\n' });
  assert.equal(compare(original, moved, { renames: [{ from: 'old.py', to: 'new.py' }] }).items[0].status, 'CHANGED');
});

const changes = [
  ['removed parameter', 'x, y=1', 'x'], ['keyword rename', 'x', 'y'], ['required parameter', 'x', 'x, y'],
  ['stricter kind', 'x', 'x, /'], ['removed default', 'x=1', 'x'], ['annotation', 'x: int', 'x: str'],
];
for (const [label, before, after] of changes) pythonTest(`Python signature change: ${label}`, (t) => {
  const a = snapshot(t, { 'orchard.py': `def pick(${before}) -> int: pass\n` });
  const b = snapshot(t, { 'orchard.py': `def pick(${after}) -> int: pass\n` });
  assert.equal(compare(a, b).items[0]?.status, 'CHANGED');
});
pythonTest('Python compatible optional parameters stay unchanged and new exports are added', (t) => {
  const a = snapshot(t, { 'orchard.py': 'def pick(x: int) -> int: pass\n' });
  const b = snapshot(t, { 'orchard.py': 'def pick(x: int, y=1, *, z=2) -> int: pass\ndef plant(): pass\n' });
  assert.deepEqual(compare(a, b).items.map((i) => [i.name, i.status]), [['plant', 'ADDED']]);
});
pythonTest('Python computed public names remain UNKNOWN in comparisons', (t) => {
  const a = snapshot(t, { 'orchard.py': 'def pick(): pass\n' });
  const b = snapshot(t, { 'orchard.py': '__all__ = discover()\ndef pick(): pass\n' });
  assert.equal(compare(a, b).items.find((i) => i.name === 'pick').status, 'UNKNOWN');
});
pythonTest('Python call sites check arguments and separate dynamic consumers', (t) => {
  const user = 'from orchard import pick\npick(1, 2, 3)\npick(1, bad=2)\npick()\npick(1)\npick(*values)\npick(**values)\nalias = pick\nalias(1)\n';
  const a = snapshot(t, { 'orchard.py': 'def pick(x, y=1): pass\n', 'user.py': user });
  const b = snapshot(t, { 'orchard.py': 'def pick(x): pass\n', 'user.py': user });
  const calls = callSites(compare(a, b).items, b, b.texts);
  assert.deepEqual(calls.sites.filter((s) => s.likelyBreak).map((s) => s.line), [2, 3, 4]);
  assert.deepEqual(calls.sites.filter((s) => s.compatibility === 'UNKNOWN').map((s) => s.line), [6, 7, 9]);
});

pythonTest('Python return annotations constructors fields and call decorators change signatures', (t) => {
  const a = snapshot(t, { 'orchard.py': 'def pick(x) -> int: pass\nclass Tree:\n height: int\n def __init__(self, size=1): pass\n @staticmethod\n def grow(): pass\n' });
  const b = snapshot(t, { 'orchard.py': 'def pick(x) -> str: pass\nclass Tree:\n height: str\n def __init__(self, size): pass\n @classmethod\n def grow(cls): pass\n' });
  assert.deepEqual(compare(a, b).items.map((i) => [i.name, i.status]), [['pick', 'CHANGED'], ['Tree', 'CHANGED']]);
});
pythonTest('Python stub-only packages and named tuple typed dictionary and model fields are syntax facts', (t) => {
  const a = snapshot(t, { 'orchard.py': 'def pick(wrong): pass\n', 'orchard-stubs/__init__.pyi': 'def pick(x: int) -> int: ...\n',
    'shapes.py': 'from typing import NamedTuple, TypedDict\nfrom pydantic import BaseModel\nclass Row(NamedTuple):\n value: int\nclass Payload(TypedDict):\n value: str\nclass Model(BaseModel):\n value: float = 2\n' });
  assert.equal(a.facts.files.find((f) => f.path === 'orchard.py').signatures[0].signatureSource, 'orchard-stubs/__init__.pyi');
  assert.deepEqual(a.facts.files.find((f) => f.path === 'shapes.py').signatures.map((s) => s.python.fields[0].annotation), ['float', 'str', 'int']);
});
pythonTest('Python dynamic getattr variadic signatures and shadowed consumers stay UNKNOWN', (t) => {
  const user = 'import orchard as o\ngetattr(o, "pick")(1)\ngetattr(o, key)(1)\no.pick(1)\ndef local(o):\n o.pick()\n';
  const a = snapshot(t, { 'orchard.py': 'def pick(x): pass\n', 'user.py': user });
  const b = snapshot(t, { 'orchard.py': 'def pick(x, *args, **kwargs): pass\n', 'user.py': user });
  // Variadic signatures stay unknown even when a comparison treats the addition as compatible.
  const items = [{ path: 'orchard.py', name: 'pick', group: 'module', status: 'CHANGED', consumers: { items: [{ path: 'user.py', via: 'namespace' }] } }];
  const sites = callSites(items, b, b.texts).sites;
  assert.equal(sites.length, 4);
  assert.ok(sites.every((s) => s.compatibility === 'UNKNOWN' && s.likelyBreak === null));
  assert.equal(compare(a, b).items.length, 0);
});
pythonTest('Python export findings distinguish unused test-only source-used and entry-point names', (t) => {
  const { facts } = snapshot(t, { 'orchard.py': 'def pick(): pass\ndef unused(): pass\ndef checked(): pass\n',
    'user.py': 'from orchard import pick\npick()\n', 'tests/test_orchard.py': 'from orchard import checked\ndef test_check():\n assert checked() is None\n' });
  const data = { files: facts.files, testFiles: facts.testFacts, startedPaths: { entries: [] } };
  const findings = deriveFindings(analyzeProject(data));
  assert.ok(findings.some((f) => f.ruleId === 'EXPORT-UNREFERENCED' && f.location.symbol === 'unused'));
  assert.ok(findings.some((f) => f.ruleId === 'EXPORT-TEST-ONLY' && f.location.symbol === 'checked'));
  assert.equal(findings.some((f) => f.ruleId.startsWith('EXPORT-') && f.location.symbol === 'pick'), false);
  const entry = deriveFindings(analyzeProject({ ...data, startedPaths: { entries: [{ path: 'orchard.py' }] } }));
  assert.equal(entry.some((f) => f.ruleId.startsWith('EXPORT-') && f.location.path === 'orchard.py'), false);
  assert.ok(findings.some((f) => f.ruleId === 'TEST-EXPORT-CANDIDATE' && f.location.symbol === 'unused'));
});

pythonTest('Python stub-only imports resolve and stub edits change snapshot identity', async (t) => {
  const { collect, mapData } = await import('../lib/build.mjs');
  const { defaults } = await import('../lib/project.mjs');
  const { analysisInputs, analysisId } = await import('../lib/inputs.mjs');
  const { writeFileSync } = await import('node:fs');
  const { join } = await import('node:path');
  const root = fixture(t, { 'orchard-stubs/__init__.pyi': 'def pick(x: int) -> int: ...\n', 'user.py': 'from orchard import pick\npick(1)\n' });
  const facts = collect(root, defaults, { worktree: true });
  const data = mapData(root, defaults, facts, 1, true);
  assert.ok(data.analysis.api.files['orchard-stubs/__init__.pyi']);
  assert.equal(data.analysis.files.find((f) => f.path === 'user.py').imports[0].target, 'orchard-stubs/__init__.pyi');
  const before = analysisId(analysisInputs(root, defaults, { worktree: true }, null));
  writeFileSync(join(root, 'orchard-stubs/__init__.pyi'), 'def pick(x: str) -> str: ...\n');
  assert.notEqual(analysisId(analysisInputs(root, defaults, { worktree: true }, null)), before);
});

pythonTest('Python local names stay silent when star imports make usage uncertain', (t) => {
  const { facts } = snapshot(t, { 'orchard.py': '__all__ = ["pick", "missing"]\ndef pick(): pass\n', 'user.py': 'from orchard import *\npick()\n' });
  assert.equal(deriveFindings(analyzeProject({ files: facts.files, testFiles: [] })).some((f) => f.ruleId.startsWith('EXPORT-')), false);
});

pythonTest('Python positional-only renames and optional keyword-only additions are compatible', (t) => {
  const a = snapshot(t, { 'orchard.py': 'def pick(x, /, *, z=1): pass\n' });
  const b = snapshot(t, { 'orchard.py': 'def pick(renamed, /, *, x=1, z=1): pass\n' });
  assert.deepEqual(compare(a, b).items, []);
});
pythonTest('Python mutations outside literal all statements retain UNKNOWN names', () => {
  assert.equal(parse("__all__ = ['pick']\nif option:\n __all__.append('grow')\ndef pick(): pass\n").publicApi.state, 'UNKNOWN');
  assert.equal(parse("__all__ = ['pick']\n__all__[0] = 'grow'\ndef pick(): pass\n").publicApi.state, 'UNKNOWN');
});
pythonTest('Python constructors and dataclass fields check required and keyword-only arguments', (t) => {
  const b = snapshot(t, { 'orchard.py': 'from dataclasses import dataclass\nclass Empty: pass\nclass Tree:\n def __init__(self, size): pass\n@dataclass(kw_only=True)\nclass Row:\n value: int\n',
    'user.py': 'from orchard import Empty, Tree, Row\nEmpty(1)\nTree()\nTree(1)\nRow(1)\nRow(value=1)\n' });
  const items = ['Empty', 'Tree', 'Row'].map((name) => ({ path: 'orchard.py', name, group: 'module', status: 'CHANGED', consumers: { items: [{ path: 'user.py', via: 'name' }] } }));
  const sites = callSites(items, b, b.texts).sites;
  assert.deepEqual(sites.filter((s) => s.likelyBreak).map((s) => s.line).sort(), [2, 3, 5]);
  assert.equal(sites.filter((s) => s.compatibility === 'COMPATIBLE').length, 2);
});

pythonTest('Python malformed modules and missing literal names give UNKNOWN without removal leads', (t) => {
  const a = snapshot(t, { 'orchard.py': 'def pick(): pass\n' });
  const b = snapshot(t, { 'orchard.py': 'def pick(:\n' });
  assert.equal(compare(a, b).items.find((i) => i.name === 'pick').status, 'UNKNOWN');
  const missing = snapshot(t, { 'orchard.py': '__all__ = ["invented"]\n' });
  assert.equal(missing.data.analysis.api.files['orchard.py'][0].kind, 'unknown');
});

pythonTest('Python escaped callable aliases and custom constructors remain UNKNOWN', (t) => {
  const head = snapshot(t, { 'orchard.py': 'def pick(x): pass\nclass Tree:\n def __new__(cls, *args): pass\n',
    'user.py': 'from orchard import pick, Tree\nchosen = wrap(pick)\nchosen()\nTree(1)\n' });
  const items = ['pick', 'Tree'].map((name) => ({ path: 'orchard.py', name, group: 'module', status: 'CHANGED', consumers: { items: [{ path: 'user.py', via: 'name' }] } }));
  const sites = callSites(items, head, head.texts).sites;
  assert.ok(sites.some((s) => s.export.name === 'pick' && s.compatibility === 'UNKNOWN'));
  assert.equal(sites.find((s) => s.export.name === 'Tree').compatibility, 'UNKNOWN');
});
pythonTest('Python dataclass disabled and inherited constructors give no false argument lead', (t) => {
  const head = snapshot(t, { 'orchard.py': 'from dataclasses import dataclass\n@dataclass(init=False)\nclass Tree:\n value: int\n@dataclass\nclass Row(Base):\n value: int\n',
    'user.py': 'from orchard import Tree, Row\nTree()\nRow(inherited=1, value=2)\n' });
  const items = ['Tree', 'Row'].map((name) => ({ path: 'orchard.py', name, group: 'module', status: 'CHANGED', consumers: { items: [{ path: 'user.py', via: 'name' }] } }));
  const sites = callSites(items, head, head.texts).sites;
  assert.ok(sites.every((s) => s.likelyBreak === null));
});

pythonTest('Python module member imports bind each target and reexports keep declaring signatures', (t) => {
  const head = snapshot(t, { 'grove/__init__.py': '', 'grove/fruit.py': 'def pick(x): pass\n', 'grove/seed.py': 'def plant(x): pass\n',
    'user.py': 'from grove import fruit, seed\nfruit.pick()\nseed.plant()\n',
    'forward.py': 'from grove import fruit as fruit\n' });
  const items = [['grove/fruit.py', 'pick'], ['grove/seed.py', 'plant']].map(([path, name]) => ({ path, name, group: 'module', status: 'CHANGED', consumers: { items: [{ path: 'user.py', via: 'namespace' }] } }));
  const sites = callSites(items, head, head.texts).sites;
  assert.deepEqual(sites.map((s) => [s.export.name, s.likelyBreak]), [['pick', true], ['plant', true]]);
  assert.equal(surfaces(head.data.analysis.api.files)('forward.py').get('fruit').kind, 'namespace');
});

pythonTest('Python aliased package reexports retain their public and declaring names', (t) => {
  const a = snapshot(t, { 'grove/__init__.py': 'from .core import pick as chosen\n__all__ = ["chosen"]\n', 'grove/core.py': 'def pick(x): pass\n' });
  const pkg = a.facts.files.find((f) => f.path === 'grove/__init__.py');
  assert.equal(pkg.reexports[0].name, 'chosen');
  assert.equal(pkg.reexports[0].imported, 'pick');
  assert.equal(surfaces(a.data.analysis.api.files)(pkg.path).get('chosen').declaredName, 'pick');
});

pythonTest('Python public reexports follow private declaring functions without exporting the private name', (t) => {
  const a = snapshot(t, { 'grove/__init__.py': 'from .core import _pick as pick\n__all__ = ["pick"]\n', 'grove/core.py': 'def _pick(x: int) -> int: pass\n' });
  const b = snapshot(t, { 'grove/__init__.py': 'from .core import _pick as pick\n__all__ = ["pick"]\n', 'grove/core.py': 'def _pick(x: str) -> int: pass\n' });
  assert.deepEqual(a.facts.files.find((f) => f.path === 'grove/core.py').exports, []);
  const surface = surfaces(a.data.analysis.api.files)('grove/__init__.py').get('pick');
  assert.equal(surface.kind, 'function');
  assert.equal(surface.declaredIn, 'grove/core.py');
  assert.equal(compare(a, b).items.find((i) => i.name === 'pick').status, 'CHANGED');
  assert.equal(compare(a, b).items.some((i) => i.name === '_pick'), false);
});

pythonTest('Python rebound definitions parse and custom metaclasses retain UNKNOWN calls', (t) => {
  const head = snapshot(t, { 'orchard.py': 'pick = None\ndef pick(x): pass\nclass Tree(metaclass=Factory): pass\n', 'user.py': 'from orchard import Tree\nTree(1)\n' });
  assert.equal(head.facts.report.skipped.length, 0);
  assert.equal(head.facts.files.find((f) => f.path === 'orchard.py').signatures.find((s) => s.name === 'pick').kind, 'function');
  const items = [{ path: 'orchard.py', name: 'Tree', group: 'module', status: 'CHANGED', consumers: { items: [{ path: 'user.py', via: 'name' }] } }];
  assert.equal(callSites(items, head, head.texts).sites[0].compatibility, 'UNKNOWN');
});

pythonTest('Python conditional public declarations stay UNKNOWN instead of removed', (t) => {
  const a = snapshot(t, { 'orchard.py': 'def pick(x): pass\n' });
  const b = snapshot(t, { 'orchard.py': 'if enabled:\n def pick(x): pass\n' });
  assert.equal(compare(a, b).items.find((i) => i.name === 'pick').status, 'UNKNOWN');
});

pythonTest('Python stub packages match module names beneath source roots', (t) => {
  const a = snapshot(t, { 'src/orchard.py': 'def pick(wrong): pass\n', 'src/orchard-stubs/__init__.pyi': 'def pick(value: int) -> int: ...\n', 'src/grove/core.py': 'def pick(wrong): pass\n', 'src/grove-stubs/core.pyi': 'def pick(value: int) -> int: ...\n' });
  assert.equal(a.facts.files.find((f) => f.path === 'src/orchard.py').signatures[0].signatureSource, 'src/orchard-stubs/__init__.pyi');
  assert.equal(a.facts.files.find((f) => f.path === 'src/grove/core.py').signatures[0].signatureSource, 'src/grove-stubs/core.pyi');
});

pythonTest('Python properties retain getter setter and static method call forms', () => {
  const facts = parse('class Tree:\n @property\n def height(self) -> int: pass\n @height.setter\n def height(self, value: int) -> None: pass\n @staticmethod\n def grow(value=build()): pass\n');
  const methods = facts.publicApi.exports[0].shape.methods;
  assert.equal(methods.height.length, 2);
  assert.deepEqual(methods.height[0].decorators, ['property']);
  assert.deepEqual(methods.height[1].decorators, ['height.setter']);
  assert.deepEqual(methods.grow[0].decorators, ['staticmethod']);
  assert.deepEqual(methods.grow[0].parameters[0].default, { exists: true });
});

pythonTest('Python optional constructor and method parameters preserve class compatibility', (t) => {
  const a = snapshot(t, { 'orchard.py': 'class Tree:\n def __init__(self, x): pass\n def grow(self, x): pass\n' });
  const b = snapshot(t, { 'orchard.py': 'class Tree:\n def __init__(self, x, y=1): pass\n def grow(self, x, *, y=1): pass\n' });
  assert.deepEqual(compare(a, b).items, []);
});
pythonTest('Python new required constructors change a default constructor', (t) => {
  const a = snapshot(t, { 'orchard.py': 'class Tree: pass\n' });
  const b = snapshot(t, { 'orchard.py': 'class Tree:\n def __init__(self, required): pass\n' });
  assert.equal(compare(a, b).items[0].status, 'CHANGED');
});

pythonTest('Python removed public methods handle object prototype names', (t) => {
  const a = snapshot(t, { 'orchard.py': 'class Tree:\n def constructor(self, x): pass\n' });
  const b = snapshot(t, { 'orchard.py': 'class Tree: pass\n' });
  assert.equal(compare(a, b).items[0].status, 'CHANGED');
});

pythonTest('Python export rename pairing preserves parameter names', (t) => {
  const a = snapshot(t, { 'orchard.py': 'def pick(pick): pass\n' });
  const b = snapshot(t, { 'orchard.py': 'def plant(plant): pass\n' });
  assert.deepEqual(compare(a, b).items.map((i) => i.status), ['REMOVED', 'ADDED']);
});

pythonTest('Python export rename pairing preserves reexport targets', (t) => {
  const a = snapshot(t, { 'orchard.py': 'from basket import value as pick\n__all__ = ["pick"]\n' });
  const b = snapshot(t, { 'orchard.py': 'from grove import other as plant\n__all__ = ["plant"]\n' });
  assert.deepEqual(compare(a, b).items.map((i) => i.status), ['REMOVED', 'ADDED']);
});

pythonTest('Python rebound imports local definitions and indirect calls do not produce false argument leads', (t) => {
  const head = snapshot(t, { 'orchard.py': 'def pick(required): pass\n', 'basket.py': 'def pick(): pass\n',
    'local.py': 'from orchard import pick\ndef pick(value=1): pass\npick()\n',
    'rebound.py': 'from orchard import pick\nfrom basket import pick\npick()\n',
    'indirect.py': 'from orchard import pick\npick(1)()\n' });
  const items = [{ path: 'orchard.py', name: 'pick', group: 'module', status: 'CHANGED', consumers: { items: ['local.py', 'rebound.py', 'indirect.py'].map((path) => ({ path, via: 'name' })) } }];
  const sites = callSites(items, head, head.texts).sites;
  assert.equal(sites.filter((s) => s.likelyBreak).length, 0);
  assert.equal(sites.filter((s) => s.compatibility === 'UNKNOWN').length, 3);
});

pythonTest('Python unresolved sibling imports never borrow another module target', (t) => {
  const head = snapshot(t, { 'grove/branch.py': 'def missing(required): pass\n', 'user.py': 'from grove import branch, missing\nmissing()\n' });
  const items = [{ path: 'grove/branch.py', name: 'missing', group: 'module', status: 'CHANGED', consumers: { items: [{ path: 'user.py', via: 'namespace' }] } }];
  assert.deepEqual(callSites(items, head, head.texts).sites, []);
});

pythonTest('Python variadic constructors retain UNKNOWN argument compatibility', (t) => {
  const head = snapshot(t, { 'orchard.py': 'class Tree:\n def __init__(*args): pass\n', 'user.py': 'from orchard import Tree\nTree(1)\n' });
  const items = [{ path: 'orchard.py', name: 'Tree', group: 'module', status: 'CHANGED', consumers: { items: [{ path: 'user.py', via: 'name' }] } }];
  assert.equal(callSites(items, head, head.texts).sites[0].compatibility, 'UNKNOWN');
});
