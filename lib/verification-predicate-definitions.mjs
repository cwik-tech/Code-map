// Predicate meanings belong to the stored rubric, independent of observed outcomes.
import { conditions } from './verify-words.mjs';
const meanings = {
  'si.clean-compiler-public-known': 'A clean compiler report exists and the complete comparable public API has no unknown change.',
  'vc.isolated-statements-functions': 'Isolated coverage reaches 90 percent of changed statements and every changed function, without missing or ambiguous mappings.',
  'bc.failed-behavior': 'A new failure, preservation failure or regression failure has eligible evidence.',
  'bc.unfiltered-criteria': 'An isolated unfiltered head run exists and every declared acceptance criterion passes.',
  'bc.mutation-sixty-ten': 'A bound mutation report reaches score 60 with at least ten measured mutants.',
  'cc.docs-stale-clean': 'The migrations and documentation check passes and the stale-reference check passes.',
  'cc.all-consumers-compatible': 'Complete comparable API changes have no unknown status and every unchanged consumer has compatible compiler evidence.',
};
/** Gives each stored predicate a stable ID and an explicit condition. */
export function predicateDefinition({ id }) {
  const share = /^vc\.changed-(lines|branches)-(\d+)$/.exec(id);
  const condition = conditions[id]?.[1] ?? meanings[id] ?? (share ? `Bound coverage reaches ${share[2]} percent of changed ${share[1]}.` : null);
  if (!condition) throw new Error(`No stored rubric definition exists for predicate ${id}.`);
  return { id, condition };
}
