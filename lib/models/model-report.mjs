// The model report (C22 to C24) that the summary shows, and the project lists that `--part models.<list>` pages through.
// Pure: it reads the stored analysis. `partCommand(part)` prints the command for the first page of one list.

/** The project lists of the model report, by part name. They are empty when the snapshot has no model. */
export function modelParts(analysis) {
  const models = analysis.models;
  return { 'models.boundaries': models?.boundaries ?? [], 'models.states': models?.states ?? [], 'models.decisions': models?.decisions ?? [],
    'models.cases': models?.cases ?? [], 'models.errors': models?.errors ?? [] };
}

const sum = (list, pick) => list.reduce((total, item) => total + pick(item), 0);

/** The counts of the model report, with a command for each list. */
export function modelSummary(analysis, partCommand) {
  const models = analysis.models;
  if (!models) return { available: false, text: 'This stored analysis has no model report. Run code-map inspect --summary again for a new analysis.' };
  const fields = models.boundaries.flatMap((schema) => schema.fields), values = fields.flatMap((field) => field.values);
  const transitions = models.states.flatMap((model) => model.transitions), tables = models.decisions;
  return { available: true,
    boundaries: { schemas: models.boundaries.length, fields: fields.length, values: values.length, named: values.filter((value) => value.named).length,
      unknownFields: fields.filter((field) => field.state === 'UNKNOWN').length, next: partCommand('models.boundaries') },
    states: { models: models.states.length, declared: models.states.filter((model) => model.source === 'declared').length, xstate: models.states.filter((model) => model.source === 'xstate').length,
      transitions: transitions.length, named: transitions.filter((transition) => transition.named === true).length, unreachable: sum(models.states, (model) => model.unreachable.length),
      deadEnds: sum(models.states, (model) => model.deadEnds.length), unhandled: sum(models.states, (model) => sum(model.unhandled, (item) => item.events.length)),
      unknownEvents: sum(models.states, (model) => model.unknownEvents.length), next: partCommand('models.states') },
    decisions: { tables: tables.length, rules: sum(tables, (table) => table.rules), overlaps: sum(tables, (table) => table.overlaps.length),
      conflicts: sum(tables, (table) => table.overlaps.filter((overlap) => overlap.conflict).length), cases: models.cases.length, gaps: sum(tables, (table) => table.gaps.length),
      pairwise: tables.filter((table) => table.method === 'pairwise').length, next: partCommand('models.decisions'), nextCases: partCommand('models.cases') },
    errors: { total: models.errors.length, next: partCommand('models.errors') },
    text: 'Code-map read the Zod schemas, Pydantic fields and the XState machines of the source files, and the model files in .code-map/models and .code-map/decisions. It ran no test. '
      + 'A value or a transition is named in a test when a test file that imports its file contains the value or sends the event. This is a weak static signal, not a test result.' };
}
