// Mutation parsing uses the same interpreter, isolated cwd and limits as facts.py.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findInterpreter } from './interpreter.mjs';
import { pythonLimits } from './parse.mjs';
const record = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
function parse(repository, config, payload) {
  const choice = findInterpreter(config.python?.interpreter, repository);
  if (choice.state !== 'KNOWN') throw new Error(choice.reason);
  const input = JSON.stringify(payload);
  if (Buffer.byteLength(input) > pythonLimits.inputBytes) throw new Error('Python mutation exceeds the parser input limit.');
  const cwd = mkdtempSync(join(tmpdir(), 'code-map-python-mutants-'));
  try {
    const result = spawnSync(choice.interpreter.path, ['-I', '-S', '-B', '-W', 'ignore', fileURLToPath(new URL('./mutants.py', import.meta.url))],
      { cwd, input, shell: false, encoding: 'utf8', timeout: pythonLimits.timeoutMs, maxBuffer: pythonLimits.outputBytes });
    if (result.error || result.status !== 0) throw new Error(`Python mutation parser failed: ${result.error?.code ?? result.status}.`);
    let value;
    try { value = JSON.parse(result.stdout); } catch { throw new Error('Invalid Python mutation parser response.'); }
    if (!record(value) || typeof value.ok !== 'boolean' || !value.ok && typeof value.error !== 'string') throw new Error('Invalid Python mutation parser response.');
    return value;
  } finally { rmSync(cwd, { recursive: true, force: true }); }
}
const position = (v) => record(v) && Number.isSafeInteger(v.line) && v.line > 0 && Number.isSafeInteger(v.column) && v.column >= 0;
export function pythonMutants(repository, config, path, text, lines) {
  const value = parse(repository, config, { mode: 'generate', path, text, lines });
  if (!value.ok) throw new Error(`Python mutation parse failed: ${value.error}`);
  const names = ['Comparison', 'LogicalOperator', 'ArithmeticOperator', 'BooleanLiteral', 'UnaryNot', 'ReturnNone'];
  if (!Array.isArray(value.edits) || !value.edits.every((edit) => record(edit) && edit.path === path && names.includes(edit.mutatorName)
    && Number.isSafeInteger(edit.start) && Number.isSafeInteger(edit.end) && edit.start >= 0 && edit.end > edit.start && edit.end <= text.length
    && typeof edit.original === 'string' && edit.original === text.slice(edit.start, edit.end) && typeof edit.replacement === 'string'
    && record(edit.location) && position(edit.location.start) && position(edit.location.end)
    && lines.includes(edit.location.start.line))) throw new Error('Invalid Python mutation edits.');
  return value.edits;
}
export function pythonCompileError(repository, config, path, text) {
  return !parse(repository, config, { mode: 'compile', path, text }).ok;
}
