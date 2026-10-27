// The model report of one analysis (C22 to C24): the boundary values of the Zod schemas, the state models (XState machines and
// declared model files) and the decision tables, with the test files that name a case. Pure: the caller gives the parsed source
// files, the test files with their imports, the file texts, the model files and the paths of the snapshot. Code-map reads a test
// file again only when it imports a file with a schema or a machine, or the subject of a declared model.
import { checkDecisionTable, validateDecisionTable } from './decision-table.mjs';
import { checkStateModel, declaredMachine, validateStateModel } from './state-model.mjs';
import { testModelFacts } from './test-facts.mjs';
import { xstateMachines } from './xstate.mjs';
import { annotationRanges, jsonRanges } from './ranges.mjs';
import { zodSchemas } from './zod.mjs';

const byPath = (a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
const byPlace = (a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : (a.line ?? 0) - (b.line ?? 0));

/** The Zod schemas and the XState machines of a parsed source file, or null when it has neither. */
export function sourceModels(source) {
  const schemas = source.fileName.endsWith('.schema.json') ? jsonRanges(source.fileName, source.text) : [...zodSchemas(source), ...annotationRanges(source)], machines = xstateMachines(source);
  return schemas.length || machines.length ? { schemas, machines } : null;
}

/** A test names a boundary value with a literal: the number, or for a length a string or an array literal of that length. An enum member needs its string. */
const names = (facts, type, value) => (type === 'enum' ? facts.strings.has(value) || facts.numbers.has(value) || facts.booleans?.has(value) || facts.nulls?.has(value)
  : facts.numbers.has(value) || (type === 'string' && facts.stringLengths.has(value)) || (type === 'array' && facts.arrayLengths.has(value)));

/**
 * `files`: the parsed source files with their `models` facts. `testFacts`: the test files with their direct imports. `texts`: the
 * text of each test file. `modelFiles`: the result of readModelFiles. `paths`: every path of the snapshot, for the subject check.
 */
export function analyzeModels({ files = [], testFacts = [], texts = new Map(), modelFiles = { files: [], errors: [] }, paths = [], jsonBoundaries = [] } = {}) {
  const facts = new Map(), sources = new Map(files.map((file) => [file.path, file])), all = new Set(paths);
  const testSources = new Map(testFacts.map((file) => [file.path, file]));
  const factsOf = (path) => {
    if (!facts.has(path)) {
      const literals = testSources.get(path)?.modelLiterals;
      facts.set(path, literals ? { ...Object.fromEntries(Object.entries(literals).map(([key, values]) => [key, new Set(values)])), sends: new Set() }
        : testModelFacts(path, texts.get(path) ?? ''));
    }
    return facts.get(path);
  };
  const testsOf = (path) => testFacts.filter((test) => test.imports.includes(path)).map((test) => test.path).sort();
  const sendsOf = (tests) => {
    const sends = new Map();
    for (const test of tests) for (const event of factsOf(test).sends) sends.set(event, [...(sends.get(event) ?? []), test]);
    return sends;
  };
  const subjectOf = ({ file, export: name }) => ({ file, export: name,
    state: sources.has(file) ? (sources.get(file).exports.includes(name) ? 'found' : 'export-missing') : all.has(file) ? 'not-analyzed' : 'file-missing' });
  const boundaries = [], states = [], decisions = [], cases = [], errors = [...modelFiles.errors];
  for (const entry of jsonBoundaries) if (!Array.isArray(entry.schemas)) {
    errors.push({ path: entry.path, kind: 'json-schema', reason: entry.reason ?? 'unreadable', problems: [{ path: '', message: 'The boundary schema is unreadable.' }] });
  }
  for (const file of [...files, ...jsonBoundaries.map((x) => ({ path: x.path, models: { schemas: x.schemas ?? [], machines: [] } }))]) {
    if (!file.models) continue;
    errors.push(...(file.models.errors ?? []));
    const tests = testsOf(file.path);
    for (const { name, line, exported, fields, source, language, state } of file.models.schemas) {
      boundaries.push({ name, ...(language ? { language } : {}), ...(state ? { state } : {}), ...(source ? { source } : {}), file: file.path, line, exported, tests, fields: fields.map((field) => ({ ...field, values: field.values.map((value) => {
        const named = tests.filter((test) => names(factsOf(test), field.type, value.value));
        return { ...value, named: named.length > 0, tests: named };
      }) })) });
    }
    for (const machine of file.models.machines) {
      states.push({ name: machine.variable ?? machine.id ?? `machine at line ${machine.line}`, source: 'xstate', file: file.path, line: machine.line, id: machine.id, subject: null, tests,
        ...checkStateModel(machine, sendsOf(tests)) });
    }
  }
  for (const { path, kind, value } of modelFiles.files) {
    const checked = kind === 'state-model' ? validateStateModel(value) : validateDecisionTable(value);
    if (!checked.ok) { errors.push({ path, kind, reason: 'invalid', problems: checked.problems }); continue; }
    if (kind === 'state-model') {
      // Without a subject, no test file is linked to the model, so `named` is null: Code-map cannot tell.
      const { model } = checked, subject = model.subject ? subjectOf(model.subject) : null, tests = subject ? testsOf(subject.file) : [];
      states.push({ name: model.name, source: 'declared', file: path, line: null, id: null, subject, tests, ...checkStateModel(declaredMachine(model), subject ? sendsOf(tests) : null) });
      continue;
    }
    const { table } = checked, result = checkDecisionTable(table);
    decisions.push({ name: table.name, file: path, subject: subjectOf(table.subject), conditions: table.conditions, rules: table.rules.length, method: result.method,
      combinations: result.combinations, cases: result.cases.length, overlaps: result.overlaps, gaps: result.gaps, gapsComplete: result.gapsComplete });
    cases.push(...result.cases.map((item, index) => ({ table: table.name, file: path, index, ...item })));
  }
  return { boundaries: boundaries.sort(byPlace), states: states.sort(byPlace), decisions, cases, errors: errors.sort(byPath) };
}
