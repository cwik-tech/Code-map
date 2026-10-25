import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { repository } from './nextjs-fixture.mjs';
import { pythonTest } from './python-fixtures.mjs';

pythonTest('inspection and static verification expose Python boundaries and settings through shared reports', (t) => {
  const f = repository(t, { 'pyproject.toml': '', '.env.example': 'COUNT=\n',
    'model.py': 'from pydantic_settings import BaseSettings\nfrom pydantic import Field\nclass Settings(BaseSettings):\n    COUNT: int = Field(ge=2)\n',
    'test_model.py': 'from model import Settings\ndef test_count():\n    assert Settings(COUNT=2)\n',
  });
  const output = f.run(['inspect', '--worktree', '--summary', '--store', f.store]);
  assert.equal(output.status, 0, output.error?.message ?? output.stderr);
  const summary = JSON.parse(output.stdout);
  assert.equal(summary.models.boundaries.schemas, 1);
  assert.equal(summary.models.boundaries.named, 1);
  assert.equal(summary.frameworks.env.reads.named, 1);
  assert.ok(!summary.findings.byRule.some((x) => x.ruleId.startsWith('ENV-')));
  const request = join(f.store, 'request.json');
  writeFileSync(request, JSON.stringify({ requestType: 'code-map-verification-request', schemaVersion: 1,
    base: 'HEAD', head: 'worktree', intent: 'Read Python settings and constraints', acceptanceCriteria: [], allowedPaths: null,
    changeType: 'feature', profileId: 'static-baseline-v0', ratingRulesVersion: 'ratings-v0', reportInputs: [],
    execution: { enabled: false, authorization: null, budgets: { wallClockSeconds: 600, memoryMegabytes: 2048, outputMegabytes: 64, concurrency: 1 } } }));
  const verified = f.run(['verify', '--request', request, '--store', f.store]);
  assert.ok([1, 2, 3].includes(verified.status), verified.error?.message ?? verified.stderr);
  const results = JSON.parse(readFileSync(JSON.parse(verified.stdout).files.results, 'utf8'));
  const stored = f.run(['inspect', '--analysis', results.head.analysisId, '--part', 'models.boundaries', '--store', f.store]);
  assert.equal(stored.status, 0, stored.error?.message ?? stored.stderr);
  const boundaries = JSON.parse(stored.stdout).page.items;
  assert.equal(boundaries[0].source, 'pydantic');
  assert.equal(boundaries[0].language, 'python');
});
