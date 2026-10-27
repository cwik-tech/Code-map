import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findInterpreter } from '../lib/python/interpreter.mjs';
import { pythonLimits } from '../lib/python/parse.mjs';
import { validFile } from '../lib/python/validate.mjs';
import { pythonTest } from './python-fixtures.mjs';

pythonTest('shared traversal preserves AST order parents and source segments across files', (t) => {
  const cwd = mkdtempSync(join(tmpdir(), 'python-traversal-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const code = `import ast, importlib.util, sys
spec = importlib.util.spec_from_file_location('shared', sys.argv[1])
common = importlib.util.module_from_spec(spec)
spec.loader.exec_module(common)
sources = [
    'import os\\nfrom typing import List\\nclass Box:\\n    value: List[str]\\n    def read(self, x: int) -> str:\\n        return os.getenv("NAME")\\n',
    'word = "ł😀\\u2028\\v"\\r\\n\\fdef read(x: tuple[\\r\\n    str, int\\r\\n]) -> str:\\r\\n\\treturn "ł"\\r\\n',
    'word = "other"\\rdef read(x: int):\\r    return x\\r',
    '',
]
for text in sources:
    tree = ast.parse(text)
    expected = list(ast.walk(tree))
    assert list(common.walk(tree)) == expected
    assert common.parents(tree) == {child: node for node in expected for child in ast.iter_child_nodes(node)}
    for kinds in [(ast.Name,), (ast.Import, ast.ImportFrom), (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)]:
        assert list(common.nodes(tree, kinds)) == [node for node in expected if isinstance(node, kinds)]
    for node in expected:
        assert common.source_segment(text, node) == ast.get_source_segment(text, node)
    assert common.source_segment(text, None) is None
assert common.source_segment('left', ast.parse('left').body[0]) == 'left'
assert common.source_segment('next', ast.parse('next').body[0]) == 'next'
`;
  execFileSync(findInterpreter().interpreter.path,
    ['-I', '-S', '-B', '-W', 'ignore', '-c', code, fileURLToPath(new URL('../lib/python/extractors/common.py', import.meta.url))],
    { input: '', encoding: 'utf8', cwd, timeout: 15000 });
});

pythonTest('large annotated modules produce complete facts within a bounded CPU budget', (t) => {
  const count = 2000;
  const text = Array.from({ length: count }, (_, i) => `value_${i}: int = ${i}
def routine_${i}(a: int, b: str, c: bool, d: float, e: bytes, f: list, g: dict, h: tuple) -> int:
    return value_${i}
`).join('');
  const cwd = mkdtempSync(join(tmpdir(), 'python-large-module-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  // CPU time excludes other jobs that deschedule this background process.
  // The wall cap still bounds a stuck child. Production batch limits stay fixed.
  const code = `import contextlib, io, json, runpy, sys, time
output = io.StringIO()
start = time.process_time()
with contextlib.redirect_stdout(output):
    runpy.run_path(sys.argv[1], run_name='__main__')
elapsed = time.process_time() - start
result = json.loads(output.getvalue())
result['cpuSeconds'] = elapsed
print(json.dumps(result))
`;
  const result = JSON.parse(execFileSync(findInterpreter().interpreter.path,
    ['-I', '-S', '-B', '-W', 'ignore', '-c', code, fileURLToPath(new URL('../lib/python/facts.py', import.meta.url))],
    { input: JSON.stringify([{ path: 'generated.py', text }]), encoding: 'utf8', cwd, timeout: 60000, maxBuffer: pythonLimits.outputBytes }));
  assert.ok(result.cpuSeconds < 8, `large module used ${result.cpuSeconds} CPU seconds (budget: 8)`);
  t.diagnostic(`Parser CPU time: ${result.cpuSeconds.toFixed(3)} seconds`);
  assert.equal(result.files.length, 1);
  const [facts] = result.files;
  assert.equal(validFile(facts), true);
  assert.deepEqual(facts.errors, []);
  assert.equal(facts.definitions.length, count);
  assert.equal(facts.names.length, count * 2);
  assert.equal(facts.publicApi.exports.length, count * 2);
  assert.equal(facts.failureFacts.length, count);
  assert.equal(facts.publicApi.exports.find(({ name }) => name === 'routine_1999').shape.signatures[0].parameters.length, 8);
  assert.equal(facts.publicApi.exports.find(({ name }) => name === 'value_1999').localReferences, 1);
});
