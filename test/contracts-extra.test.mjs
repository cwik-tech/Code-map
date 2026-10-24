import assert from 'node:assert/strict';
import { test } from 'node:test';
import { deploymentEntries, compareDeployment } from '../lib/frameworks/deployment.mjs';
import { checkExamples } from '../lib/impact/examples.mjs';
import { analyzed, repository } from './nextjs-fixture.mjs';

test('deployment readers retain names without values', () => {
  const docker = deploymentEntries('Dockerfile', 'FROM node\nARG BUILD=secret-one\nENV FIRST=secret-two SECOND="secret three"\nENV OLD secret-four\n');
  assert.deepEqual(docker.names.map((x) => x.name), ['BUILD', 'FIRST', 'SECOND', 'OLD']);
  const vercel = deploymentEntries('vercel.json', '{"env":{"TOKEN":"secret-five"}}');
  assert.deepEqual(vercel.names.map((x) => x.name), ['TOKEN']);
  const compose = deploymentEntries('docker-compose.yml', 'services:\n  api:\n    environment:\n      TOKEN: secret-six\n      OTHER: "secret-seven"\n    image: node\n');
  assert.deepEqual(compose.names.map((x) => x.name), ['TOKEN', 'OTHER']);
  assert.doesNotMatch(JSON.stringify([docker, vercel, compose]), /secret/);
  assert.equal(deploymentEntries('docker-compose.yaml', 'services:\n  api:\n    environment: [TOKEN=x]').state, 'UNKNOWN');
  assert.equal(deploymentEntries('vercel.json', '{').state, 'UNKNOWN');
});

test('deployment comparison stays package-local and reports missing code and template names', () => {
  const env = { reads: [{ path: 'src/a.js', name: 'TOKEN' }, { path: 'src/a.js', name: 'MISSING' }], templates: [{ path: '.env.example', state: 'read', names: [{ name: 'TOKEN' }, { name: 'TEMPLATE' }] }] };
  const result = compareDeployment(['package.json', 'nested/package.json'], [{ path: 'Dockerfile', ...deploymentEntries('Dockerfile', 'ENV TOKEN=x EXTRA=y') }, { path: 'nested/Dockerfile', ...deploymentEntries('Dockerfile', 'ENV MISSING=x') }], env);
  assert.deepEqual(result.missingReads.map((x) => x.name), ['MISSING']);
  assert.deepEqual(result.missingTemplates.map((x) => x.name), ['TEMPLATE']);
  assert.ok(result.unused.some((x) => x.name === 'EXTRA'));
});

test('checked examples report syntax and missing self-import names with document lines', () => {
  const texts = new Map([['README.md', 'Intro\n```ts\nimport { yes, no as missing } from "pkg";\n```\n```jsx\nconst x = <div>;\n```\n```sh\nbad(\n```'], ['docs/guide.md', '```js\nconst x = ;\n```']]);
  const api = { files: { 'src/index.js': [{ name: 'yes', kind: 'function' }] }, entryPoints: { files: [{ path: 'src/index.js', package: 'package.json' }], unresolved: [] } };
  const result = checkExamples(texts, new Map([['package.json', '{"name":"pkg"}']]), api);
  assert.equal(result.blocks, 3);
  assert.deepEqual(result.issues.filter((x) => x.kind === 'missing-export').map((x) => [x.path, x.line, x.name]), [['README.md', 3, 'no']]);
  assert.deepEqual([...new Set(result.issues.filter((x) => x.kind === 'syntax').map((x) => x.path))], ['README.md', 'docs/guide.md']);
});

test('collector exposes schema, deployment and checked examples without retaining deployment values', (t) => {
  const f = repository(t, { 'package.json': '{"name":"pkg","main":"src/index.js"}', 'src/index.js': 'export const yes = process.env.TOKEN;', 'api.graphql': 'type T { id: ID }', 'api.proto': 'message T { string id = 1; }', 'Dockerfile': 'ENV TOKEN=PRIVATE_DEPLOY_VALUE', '.env.example': 'TOKEN=PRIVATE_TEMPLATE_VALUE', 'README.md': '```js\nimport { absent } from "pkg";\n```' });
  const { analysis } = analyzed(f.root);
  assert.equal(analysis.frameworks.protocols.documents.length, 2);
  assert.equal(analysis.frameworks.deployment.documents[0].names[0].name, 'TOKEN');
  assert.equal(analysis.examples.issues[0].kind, 'missing-export');
  assert.doesNotMatch(JSON.stringify(analysis), /PRIVATE_DEPLOY_VALUE|PRIVATE_TEMPLATE_VALUE/);
});
