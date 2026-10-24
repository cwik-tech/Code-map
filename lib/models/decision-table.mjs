// Decision tables (C24): the declared table files `.code-map/decisions/*.json`. A table names its conditions with their values
// and its rules. Each rule gives the value of some conditions (`when`) and an outcome (`then`). Code-map finds rules that
// overlap, and the combinations that no rule covers. It checks every combination when there are at most 4,096 of them, and
// otherwise the pairwise cases of pairwiseCases. It records the combinations for a later run. Pure.
import { isRelativePath } from '../adapters/run-manifest.mjs';
import { isRecord, literal, literalRule, subjectProblems, text, textRule, unknownFields } from './validate.mjs';

const tableVersion = 1;
/** At most this many combinations give the complete list. A larger table gets pairwise cases. */
export const exhaustiveLimit = 4096;
const maxConditions = 20, maxValues = 32, maxRules = 256;
const fields = ['tableVersion', 'name', 'subject', 'conditions', 'rules'];
const key = (value) => JSON.stringify(value);
const oracleText = (value) => typeof value === 'string' && value.trim().length > 0 && value.length <= 1000 && !/[\p{Cc}]/u.test(value);

/** { ok: true, table } or { ok: false, problems: [{ path, message }] } for the parsed JSON of a table file. */
export function validateDecisionTable(value) {
  if (!isRecord(value)) return { ok: false, problems: [{ path: '', message: 'must be an object with tableVersion, name, subject, conditions and rules.' }] };
  const problems = [], add = (path, message) => problems.push({ path, message }), conditions = new Map();
  unknownFields(value, fields, '', add);
  if (value.tableVersion !== tableVersion) add('tableVersion', `must be ${tableVersion}.`);
  if (!text(value.name)) add('name', textRule);
  subjectProblems(value.subject, add);
  if (!Array.isArray(value.conditions) || !value.conditions.length) add('conditions', `must be a list of 1 to ${maxConditions} conditions.`);
  else if (value.conditions.length > maxConditions) add('conditions', `must have at most ${maxConditions} conditions.`);
  else value.conditions.forEach((condition, index) => {
    const at = `conditions[${index}]`, values = new Set();
    if (!isRecord(condition)) { add(at, 'must be an object with name and values.'); return; }
    unknownFields(condition, ['name', 'values'], at, add);
    if (!text(condition.name)) add(`${at}.name`, textRule);
    else if (conditions.has(condition.name)) add(`${at}.name`, `repeats the condition ${JSON.stringify(condition.name)}.`);
    if (!Array.isArray(condition.values) || !condition.values.length || condition.values.length > maxValues) add(`${at}.values`, `must be a list of 1 to ${maxValues} values.`);
    else condition.values.forEach((item, position) => {
      if (!literal(item)) add(`${at}.values[${position}]`, literalRule);
      else if (values.has(key(item))) add(`${at}.values[${position}]`, `repeats the value ${key(item)}.`);
      else values.add(key(item));
    });
    if (text(condition.name) && !conditions.has(condition.name)) conditions.set(condition.name, values);
  });
  if (!Array.isArray(value.rules) || !value.rules.length) add('rules', `must be a list of 1 to ${maxRules} rules.`);
  else if (value.rules.length > maxRules) add('rules', `must have at most ${maxRules} rules.`);
  else value.rules.forEach((rule, index) => {
    const at = `rules[${index}]`;
    if (!isRecord(rule)) { add(at, 'must be an object with when and then.'); return; }
    unknownFields(rule, ['when', 'then', 'oracle'], at, add);
    if (!isRecord(rule.when)) add(`${at}.when`, 'must be an object with the value of each condition that the rule needs. A condition that it leaves out can have any value.');
    else for (const [name, item] of Object.entries(rule.when)) {
      if (!conditions.has(name)) add(`${at}.when.${name}`, 'is not a condition of the table.');
      else if (!literal(item) || !conditions.get(name).has(key(item))) add(`${at}.when.${name}`, `must be one of the values of the condition ${JSON.stringify(name)}.`);
    }
    if (rule.oracle !== undefined) {
      const oracle = rule.oracle;
      if (!isRecord(oracle)) add(`${at}.oracle`, 'must name an oracle record.');
      else {
        unknownFields(oracle, ['file', 'suite', 'name', 'criterion'], `${at}.oracle`, add);
        if (!isRelativePath(oracle.file) || oracle.file.length > 1024) add(`${at}.oracle.file`, 'must name a relative test file.');
        if (!(oracle.suite === null || oracleText(oracle.suite)) || !oracleText(oracle.name) || typeof oracle.criterion !== 'string' || !/^[A-Za-z0-9._-]{1,64}$/.test(oracle.criterion)) add(`${at}.oracle`, 'must give suite, name and criterion.');
      }
    }
    if (!Object.hasOwn(rule, 'then') || !literal(rule.then)) add(`${at}.then`, literalRule);
  });
  if (problems.length) return { ok: false, problems };
  return { ok: true, table: { tableVersion, name: value.name, subject: { file: value.subject.file, export: value.subject.export },
    conditions: value.conditions.map((condition) => ({ name: condition.name, values: [...condition.values] })), rules: value.rules.map((rule) => ({ when: rule.when, then: rule.then, ...(rule.oracle ? { oracle: rule.oracle } : {}) })) } };
}

/** Every combination of value positions, the last condition changing fastest. */
function allCases(sizes) {
  let list = [[]];
  for (const size of sizes) list = list.flatMap((prefix) => Array.from({ length: size }, (_, value) => [...prefix, value]));
  return list;
}

/**
 * The pairwise method: a deterministic greedy cover of every pair of values of two conditions. Each case starts from the first
 * pair that no case covers yet, in the order of the conditions and of their values. Each other condition then gets, in order, the
 * value that covers the most uncovered pairs with the values chosen so far. On a tie, it gets the value with the most uncovered
 * pairs in total, and then the first such value. `sizes` gives the number of values of each condition. The result holds value positions.
 */
export function pairwiseCases(sizes) {
  const count = sizes.length;
  if (count < 2) return allCases(sizes);
  const blocks = [], start = sizes.map(() => new Array(count).fill(0));
  let total = 0;
  for (let i = 0; i < count; i++) for (let j = i + 1; j < count; j++) { start[i][j] = total; blocks.push({ i, j, start: total }); total += sizes[i] * sizes[j]; }
  const id = (i, a, j, b) => (i < j ? start[i][j] + a * sizes[j] + b : start[j][i] + b * sizes[i] + a);
  // `open[k][value]`: the uncovered pairs of one value of condition k with the values of the other conditions.
  const others = sizes.map((_, k) => sizes.reduce((sum, size, m) => sum + (m === k ? 0 : size), 0)), open = sizes.map((size, k) => new Array(size).fill(others[k]));
  const covered = new Uint8Array(total), cases = [];
  let left = total, cursor = 0, block = 0;
  while (left > 0) {
    while (covered[cursor]) cursor++;
    while (block + 1 < blocks.length && blocks[block + 1].start <= cursor) block++;
    const { i, j } = blocks[block], offset = cursor - blocks[block].start, values = new Array(count).fill(-1);
    values[i] = Math.floor(offset / sizes[j]); values[j] = offset % sizes[j];
    for (let k = 0; k < count; k++) {
      if (values[k] !== -1) continue;
      let best = 0, gain = -1;
      for (let value = 0; value < sizes[k]; value++) {
        let found = 0;
        for (let m = 0; m < count; m++) if (values[m] !== -1 && !covered[id(k, value, m, values[m])]) found++;
        if (found > gain || (found === gain && open[k][value] > open[k][best])) { gain = found; best = value; }
      }
      values[k] = best;
    }
    for (let x = 0; x < count; x++) for (let y = x + 1; y < count; y++) {
      const pair = id(x, values[x], y, values[y]);
      if (!covered[pair]) { covered[pair] = 1; left--; open[x][values[x]]--; open[y][values[y]]--; }
    }
    cases.push(values);
  }
  return cases;
}

/**
 * The checks of a valid table. Each case has the values, the rules that cover it and the expected outcome: `covered` (one
 * outcome), `conflict` (rules with different outcomes, no expected outcome) or `gap` (no rule). An overlap is a pair of rules
 * that can cover the same combination, with an example. With pairwise cases, a gap outside the cases stays unseen.
 */
export function checkDecisionTable(table) {
  const { conditions, rules } = table, sizes = conditions.map((condition) => condition.values.length);
  const positions = conditions.map((condition) => new Map(condition.values.map((value, index) => [key(value), index])));
  const vectors = rules.map((rule) => conditions.map((condition, index) => (Object.hasOwn(rule.when, condition.name) ? positions[index].get(key(rule.when[condition.name])) : null)));
  const valuesOf = (combination) => Object.fromEntries(conditions.map((condition, index) => [condition.name, condition.values[combination[index]]]));
  const combinations = sizes.reduce((product, size) => product * size, 1), method = combinations <= exhaustiveLimit ? 'all' : 'pairwise';
  const cases = (method === 'all' ? allCases(sizes) : pairwiseCases(sizes)).map((combination) => {
    const hits = vectors.flatMap((vector, index) => (vector.every((value, position) => value === null || value === combination[position]) ? [index] : []));
    const outcomes = new Set(hits.map((index) => key(rules[index].then)));
    return { values: valuesOf(combination), rules: hits, expected: outcomes.size === 1 ? rules[hits[0]].then : null, state: !hits.length ? 'gap' : outcomes.size > 1 ? 'conflict' : 'covered' };
  });
  const overlaps = [];
  for (let a = 0; a < vectors.length; a++) for (let b = a + 1; b < vectors.length; b++) {
    if (!vectors[a].every((value, index) => value === null || vectors[b][index] === null || value === vectors[b][index])) continue;
    overlaps.push({ rules: [a, b], conflict: key(rules[a].then) !== key(rules[b].then), example: valuesOf(vectors[a].map((value, index) => value ?? vectors[b][index] ?? 0)) });
  }
  return { method, combinations, cases, overlaps, gaps: cases.filter((item) => item.state === 'gap').map((item) => item.values), gapsComplete: method === 'all' };
}
