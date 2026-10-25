import assert from 'node:assert/strict';
import { parsePython } from '../lib/python/parse.mjs';
import { findInterpreter } from '../lib/python/interpreter.mjs';
import { validPydantic, validSettings } from '../lib/python/model-validation.mjs';
import { pythonTest } from './python-fixtures.mjs';

pythonTest('model fact validators reject malformed limits aliases and settings literals', () => {
  const parsed = parsePython(findInterpreter().interpreter, [{ path: 'model.py', text: 'from pydantic import BaseModel, Field\nclass Row(BaseModel):\n    count: int = Field(ge=1)\n' }]);
  assert.deepEqual(parsed.errors, []);
  const { pydantic, settings } = parsed.files[0];
  assert.equal(validPydantic(pydantic), true);
  assert.equal(validSettings(settings), true);
  const malformed = structuredClone(pydantic);
  malformed.classes[0].fields[0].limits[0].limit = {};
  assert.equal(validPydantic(malformed), false);
  const alias = structuredClone(pydantic);
  alias.classes[0].fields[0].alias = [];
  assert.equal(validPydantic(alias), false);
  assert.equal(validSettings({ ...settings, literals: { ...settings.literals, numbers: [Infinity] } }), false);
});

pythonTest('Python deployment checks keep service folders separate and match settings case rules', async () => {
  const { compareDeployment, deploymentEntries } = await import('../lib/frameworks/deployment.mjs');
  const paths = ['alpha/pyproject.toml', 'beta/requirements.txt'];
  const docs = [
    { path: 'alpha/Dockerfile', ...deploymentEntries('Dockerfile', 'FROM python:3\nENV APP_HOST=example\n') },
    { path: 'beta/compose.yml', ...deploymentEntries('compose.yml', 'services:\n  worker:\n    environment:\n      OTHER: value\n') },
  ];
  const env = { templates: [], reads: [
    { path: 'alpha/settings.py', name: 'APP_host', caseSensitive: false },
    { path: 'beta/app.py', name: 'APP_HOST' },
  ] };
  const report = compareDeployment(paths, docs, env);
  assert.deepEqual(report.missingReads, [{ path: 'beta/app.py', name: 'APP_HOST' }]);
  assert.deepEqual(report.unused, [{ path: 'beta/compose.yml', name: 'OTHER' }]);
});

pythonTest('unknown Python environment reads prevent false unused declarations without hiding literal gaps', async () => {
  const { analyzeEnv } = await import('../lib/frameworks/env.mjs');
  const inputs = { paths: ['pyproject.toml'], templates: [{ path: '.env.example', state: 'read', names: [{ name: 'DECLARED', line: 1 }] }] };
  const unknown = analyzeEnv({ ...inputs, files: [{ path: 'app.py', env: [{ name: null, line: 1, via: 'os.getenv', form: 'computed', state: 'UNKNOWN', reason: 'computed-name' }] }] });
  assert.deepEqual(unknown.leads, { undeclared: [], unused: [] });
  const literal = analyzeEnv({ ...inputs, files: [{ path: 'app.py', env: [{ name: 'OTHER', line: 1, via: 'os.getenv', form: 'call' }] }] });
  assert.deepEqual(literal.leads.undeclared.map((r) => r.name), ['OTHER']);
  assert.deepEqual(literal.leads.unused.map((r) => r.name), ['DECLARED']);
});

pythonTest('case insensitive settings recognize Python platform names without changing literal JavaScript reads', async () => {
  const { analyzeEnv } = await import('../lib/frameworks/env.mjs');
  const result = analyzeEnv({ paths: ['pyproject.toml'], templates: [{ path: '.env.example', state: 'read', names: [] }],
    files: [{ path: 'settings.py', env: [{ name: 'pythonpath', caseSensitive: false, via: 'pydantic.BaseSettings', form: 'field', line: 1 }] },
      { path: 'app.ts', env: [{ name: 'pythonpath', via: 'process.env', form: 'property', line: 1 }] }] });
  assert.deepEqual(result.leads.undeclared.map((x) => x.path), ['app.ts']);
});
