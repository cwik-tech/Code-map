// Strings that several calibration cases reuse. Each case writes its own files and can also reuse these.
export const gitignore = 'reports/\n';
export const srcA = 'export const a = 1;\n';
export const bImportsA = "import { a } from './a';\nexport const b = a;\n";
export const testHeader = "import { test } from 'node:test';\nimport assert from 'node:assert/strict';\nimport { a } from '../src/a';\n";
export const engineTestHeader = "import { test } from 'node:test';\nimport assert from 'node:assert/strict';\nimport { engine } from '../src/core/engine';\n";
