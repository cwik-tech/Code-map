// Cases for structure.imports-resolve: a new import of a missing file, a new import of a name that is not exported, and a
// new import of a file and a name that exist.
import { bImportsA, gitignore, srcA } from './common.mjs';

export const cases = [
  {
    id: 'import-missing-file',
    name: 'A new import of a missing file fails the imports-resolve check',
    defect: true,
    base: { '.gitignore': gitignore, 'src/a.ts': srcA, 'src/b.ts': bImportsA },
    head: { 'src/b.ts': "import { a } from './a';\nimport { z } from './missing';\nexport const b = [a, z];\n" },
    request: { intent: 'Add an import of a missing file.' },
    expected: { readiness: 'INSUFFICIENT_EVIDENCE', checks: { 'structure.imports-resolve': 'FAIL' },
      ratings: { structuralIntegrity: 1, verificationCoverage: 'Unassessed', behavioralConfidence: 'Unassessed', changeCompleteness: 3 } },
  },
  {
    id: 'import-name-missing',
    name: 'A new import of a name that the file does not export fails the imports-resolve check',
    defect: true,
    base: { '.gitignore': gitignore, 'src/a.ts': 'export const x = 1;\n', 'src/b.ts': "import { x } from './a';\nexport const b = x;\n" },
    head: { 'src/b.ts': "import { x, missing } from './a';\nexport const b = [x, missing];\n" },
    request: { intent: 'Import another name from a.' },
    expected: { readiness: 'INSUFFICIENT_EVIDENCE', checks: { 'structure.imports-resolve': 'FAIL' } },
  },
  {
    id: 'import-clean',
    name: 'A new import of a file and a name that exist passes the imports-resolve check',
    defect: false,
    base: { '.gitignore': gitignore, 'src/a.ts': srcA, 'src/b.ts': bImportsA },
    head: { 'src/c.ts': 'export const c = 3;\n', 'src/b.ts': "import { a } from './a';\nimport { c } from './c';\nexport const b = [a, c];\n" },
    request: { intent: 'Add the file c and import it.' },
    expected: { readiness: 'INSUFFICIENT_EVIDENCE', checks: { 'structure.imports-resolve': 'PASS' },
      ratings: { structuralIntegrity: 2, verificationCoverage: 'Unassessed', behavioralConfidence: 'Unassessed', changeCompleteness: 3 } },
  },
];
