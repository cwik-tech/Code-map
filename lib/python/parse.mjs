// Bounded, isolated standard-library parser. All project texts arrive through stdin.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validFile } from './validate.mjs';

export const pythonLimits = { batchFiles: 64, inputBytes: 4 * 1024 * 1024, outputBytes: 16 * 1024 * 1024, timeoutMs: 15000 };
const record = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const strings = (v) => Array.isArray(v) && v.every((s) => typeof s === 'string');
export function parsePython(interpreter, files, config = {}) {
  const cwd = mkdtempSync(join(tmpdir(), 'code-map-python-'));
  const parsed = [], errors = [];
  let stdlib = [], settings = {}, retries = 0;
  const configEntries = Object.entries(config).map(([path, text]) => ({ path, text }));
  const configBytes = Buffer.byteLength(JSON.stringify(configEntries));
  const run = (batch) => {
    const input = JSON.stringify([...batch, ...configEntries]);
    const result = spawnSync(interpreter.path, ['-I', '-S', '-B', '-W', 'ignore', fileURLToPath(new URL('./facts.py', import.meta.url))],
      { cwd, input, encoding: 'utf8', shell: false, timeout: pythonLimits.timeoutMs, maxBuffer: pythonLimits.outputBytes });
    if (result.error || result.status !== 0) {
      if (batch.length > 1 && ['ETIMEDOUT', 'ENOBUFS'].includes(result.error?.code)) {
        const middle = Math.ceil(batch.length / 2);
        retries += 2;
        run(batch.slice(0, middle));
        run(batch.slice(middle));
        return;
      }
      errors.push(...batch.map(({ path }) => ({ path, reason: `Python parser failed or exceeded its time/output limit: ${result.error?.code ?? result.status}` })));
      return;
    }
    try {
      const value = JSON.parse(result.stdout);
      if (!record(value) || !Array.isArray(value.files) || !value.files.every(validFile) || !strings(value.stdlib) || !record(value.config)
        || value.files.length !== batch.length || value.files.some((f, i) => f.path !== batch[i].path)) throw new Error('Invalid Python facts');
      parsed.push(...value.files); stdlib = value.stdlib; settings = value.config;
    } catch { errors.push(...batch.map(({ path }) => ({ path, reason: 'Python parser returned invalid facts.' }))); }
  };
  try {
    let batch = [], bytes = configBytes;
    for (const file of files) {
      const size = Buffer.byteLength(JSON.stringify(file)) + 1;
      if (size + configBytes > pythonLimits.inputBytes) { errors.push({ path: file.path, reason: 'Python file exceeds the parser input limit.' }); continue; }
      if (batch.length >= pythonLimits.batchFiles || bytes + size > pythonLimits.inputBytes) { run(batch); batch = []; bytes = configBytes; }
      batch.push(file); bytes += size;
    }
    if (batch.length) run(batch);
    return { files: parsed, stdlib, settings, errors, retries };
  } finally { rmSync(cwd, { recursive: true, force: true }); }
}
