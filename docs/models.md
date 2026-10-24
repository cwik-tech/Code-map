# Models of expected behavior

A model tells Code-map how the code must behave. Code-map reads three kinds of model:

- **Boundary values (C22)** come from the Zod schemas in your source files.
- **State models (C23)** come from a model file in `.code-map/models/`, or from an XState machine in your source files.
- **Decision tables (C24)** come from a table file in `.code-map/decisions/`.

Code-map reads each model and derives the cases to test. For boundary values and state models, it also finds which cases your test files name. Static inspection runs no test and no project code. The [harness command](harness.md) can run Zod boundaries, declared state transitions, and decision-table cases in the restricted worker.

The capability numbers (C22, C23 and C24) come from the verification specification.

## See the report

The models block of `code-map inspect --summary` gives the counts of each kind of model and a command for each list:

```sh
code-map inspect --summary --worktree
code-map inspect --analysis <id> --part models.boundaries
```

| List (`--part`) | Items |
| --- | --- |
| `models.boundaries` | One item for each Zod schema, with its fields and their boundary values |
| `models.states` | One item for each state model, with its transitions and the results of the checks |
| `models.decisions` | One item for each decision table, with its overlaps and its gaps |
| `models.cases` | One item for each case of a decision table, for all tables |
| `models.errors` | One item for each model file that Code-map refused |

Each list comes in pages of 20 items. Follow the `next` command of a page for the next page. [The retrieval reference](retrieval.md#the-models-block) gives each field of the block.

**Named in a test** is a weak static signal. A boundary value is named in a test when a test file that imports the schema file contains the value as a literal. A transition is named in a test when a test file that imports the machine file sends its event. A named case is not a tested case. The test can use the value for another purpose, or it can check nothing.

## Boundary values from Zod schemas

A schema is a variable that holds a Zod call chain, in a file that imports `zod`:

```ts
import { z } from 'zod';

export const Signup = z.object({
  age: z.number().int().min(18).max(120),
  name: z.string().min(3).max(255),
  role: z.enum(['admin', 'user']),
});
```

Code-map records each schema with its name (`Signup`), its file and its line. Each constrained field has a `path`, such as `age`, `address.zip` or `tags[]` for the element of an array. For each limit, Code-map derives three values: the value just below the limit, the limit, and the value just above the limit.

| Zod call | Limit | Values for an integer or a length |
| --- | --- | --- |
| `.min(n)`, `.gte(n)` | n, inclusive | n-1, n and n+1. For `age` above: 17, 18 and 19 |
| `.max(n)`, `.lte(n)` | n, inclusive | n-1, n and n+1. For `age` above: 119, 120 and 121 |
| `.gt(n)`, `.lt(n)` | n, exclusive | n-1, n and n+1. Only the expected result differs from `.min(n)` and `.max(n)` |
| `.positive()`, `.negative()` | 0, exclusive | -1, 0 and 1 |
| `.nonnegative()`, `.nonpositive()` | 0, inclusive | -1, 0 and 1 |
| `.min(n)`, `.max(n)` of a string or an array | n, inclusive | The lengths n-1, n and n+1. For `name` above: 2, 3, 4, 254, 255 and 256 |
| `.length(n)` of a string or an array | Exactly n | The lengths n-1, n and n+1 |
| `.nonempty()` of a string or an array | 1, inclusive | The lengths 0, 1 and 2 |
| `.int()` or `z.int()` without other limits | Integer membership near 0 | -0.5, 0 and 0.5 |
| `z.enum([...])` | Each member | Each member, for example `'admin'` and `'user'` |

These rules decide the values:

- An integer field (`.int()` or `z.int()`) steps by 1. Every length steps by 1 too.
- Another number steps by one decimal place more than its limit. Thus `.min(1)` gives 0.9, 1 and 1.1, and `.max(2.5)` gives 2.49, 2.5 and 2.51.
- A length below 0 is left out.
- Non-finite numeric limits are UNKNOWN.
- Integer-only schemas get fractional cases around zero. These cases check integer membership, not the full numeric range.
- Each value appears one time, also when two limits give it.

Each value has `expected`: `valid` when the value passes every limit of the field, or `invalid`. For a string or an array, the value is a length. A test can use a string or an array literal of that length.

A field has one of three states:

| `state` | Meaning |
| --- | --- |
| `KNOWN` | Every check of the field is a literal limit that Code-map reads |
| `PARTIAL` | Code-map derived values. Another limit is not literal, or a check is unsupported, such as `.email()`, `.regex()` or `.refine()`. `expected` is then null, because that check can also refuse the value |
| `UNKNOWN` | Code-map derived no value. The limit, enum list or object shape is not literal, for example `.min(MAX)` or `z.enum(roles)` |

A value is named in a test when a test file that imports the schema file contains that value. For a number, the test must contain the number. For a length, the test can contain the number, or a string or an array literal of that length. For an enum member, the test must contain the string.

## State models

A state model has states, an initial state and transitions. A transition goes from one state to another state when an event occurs.

### A declared model file

Write one JSON file for each model in `.code-map/models/`, for example `.code-map/models/order.json`:

```json
{
  "modelVersion": 1,
  "name": "order",
  "states": ["new", "paid", "shipped", "cancelled"],
  "initial": "new",
  "final": ["shipped", "cancelled"],
  "transitions": [
    { "from": "new", "event": "PAY", "to": "paid" },
    { "from": "new", "event": "CANCEL", "to": "cancelled" },
    { "from": "paid", "event": "SHIP", "to": "shipped" }
  ],
  "subject": { "file": "src/order.ts", "export": "orderMachine" }
}
```

| Field | Rule |
| --- | --- |
| `modelVersion` | Must be 1 |
| `name` | A text of 1 to 200 characters on one line |
| `states` | A list of 1 to 1,000 different state names |
| `initial` | One of the states |
| `final` | Optional. A list of states that end the workflow |
| `transitions` | A list of at most 5,000 objects with `from`, `event` and `to`. `from` and `to` must be states. A state can have one transition for each event |
| `subject` | Optional. The source `file` and the `export` that implement the model. Without a subject, no test file is linked to the model, so `named` is null for each transition |

Code-map refuses a file with an unknown field or with a value that breaks a rule. The `models.errors` list then names each problem with its path, for example `transitions[2].to`.

### An XState machine

Code-map also reads a `createMachine({...})` call or a `setup({...}).createMachine({...})` call, in a file that imports `createMachine` or `setup` from `xstate`:

```ts
import { createMachine } from 'xstate';

export const door = createMachine({
  id: 'door',
  initial: 'closed',
  states: {
    closed: { on: { OPEN: 'open', LOCK: 'locked' } },
    open: { on: { CLOSE: 'closed' } },
    locked: {},
  },
});
```

Code-map reads `id`, `initial`, `type` (`final` or `parallel`), the nested `states`, and these transitions:

- The events of the `on` objects
- The eventless transitions of `always`, `after`, `onDone` and the `onDone` and `onError` of `invoke`

A target resolves as in XState 5. `'x'` is a sibling state, `'.x'` is a child state, and `'#id.x'` is a state by its ID. A nested state has a path such as `run.slow`. A part that is not a literal is UNKNOWN for that part, for example `{ target: next }` or `...shared`. A target that names no state is in the `unknown` list with the reason `target-not-found`.

### What Code-map checks in a state model

| Field | Contents |
| --- | --- |
| `transitions` | Each transition with `from`, `event` (null for an eventless transition), `kind`, `to`, `line`, `named` and `tests` |
| `unreachable` | The states that no path of transitions reaches from the initial state |
| `deadEnds` | The states without a way out that are not final. No transition of the state or of a parent state leaves it |
| `unhandled` | For each state, the events of the model that the state does not handle, also through a parent state. A final state is not in this list |
| `unknownEvents` | The events that a linked test sends, but that no transition handles |
| `reachability` | `KNOWN`, or `UNKNOWN` when a part that is not a literal can hide a target. `unreachable` is then empty |
| `unknown` | The parts that Code-map cannot read, each with `state`, `part`, `event`, `reason` and `line` |
| `state` | `KNOWN`, `PARTIAL` (the model has an UNKNOWN part) or `UNKNOWN` (the machine config is not an object literal) |

A state with an UNKNOWN part, on itself or on a parent state, gets no dead-end or unhandled-event result.
UNKNOWN configs, state lists or event handlers also prevent `unknownEvents` claims.

A transition is named in a test when a linked test file sends its event. Examples are `send('OPEN')`, `send({ type: 'OPEN' })` and `actor.send(...)`. For an XState machine, a linked test file imports the machine file. For a declared model, a linked test file imports the file of its subject.

## Decision tables

A decision table lists conditions and rules. Each rule gives the values of some conditions and an outcome. Write one JSON file for each table in `.code-map/decisions/`, for example `.code-map/decisions/discount.json`:

```json
{
  "tableVersion": 1,
  "name": "discount",
  "subject": { "file": "src/price.ts", "export": "discount" },
  "conditions": [
    { "name": "member", "values": [true, false] },
    { "name": "total", "values": ["low", "high"] }
  ],
  "rules": [
    { "when": { "member": true }, "then": 10 },
    { "when": { "member": true, "total": "high" }, "then": 15 },
    { "when": { "member": false, "total": "low" }, "then": 0 }
  ]
}
```

| Field | Rule |
| --- | --- |
| `tableVersion` | Must be 1 |
| `name` | A text of 1 to 200 characters on one line |
| `subject` | The source `file` and the `export` that implement the table. The file must be a path inside the repository |
| `conditions` | A list of 1 to 20 conditions. Each condition has a `name` and a list of 1 to 32 different `values` |
| `rules` | A list of 1 to 256 rules. `when` gives a value of the condition for some conditions. A condition that `when` leaves out can have any value. `then` is the outcome |

A value and an outcome are a text of at most 200 characters, a number, `true`, `false` or `null`.

Code-map finds these results:

- **Cases.** Each case is a combination of one value for each condition, with the rules that cover it. A case is `covered` (one outcome), `conflict` (rules with different outcomes) or `gap` (no rule). `expected` is the outcome of a covered case, and null for the other cases.
- **Overlaps.** An overlap is a pair of rules that can cover the same combination, with an `example`. `conflict` is true when the two outcomes differ. In the example above, rules 0 and 1 overlap with a conflict.
- **Gaps.** A gap is a combination that no rule covers. In the example above, `member: false` with `total: "high"` is a gap.
- **Subject.** `subject.state` is `found`, `export-missing`, `file-missing` or `not-analyzed` (the file is in the snapshot, but it is not a mapped source file).

Rules have numbers from 0, in the order of the file.

A table with at most 4,096 combinations gets every combination as a case. The method is then `all`, and the list of gaps is complete. A larger table gets pairwise cases. The method is then `pairwise`, and `gapsComplete` is false. A gap outside the pairwise cases stays unseen.

The pairwise method covers each pair of values of two conditions in at least one case. It is a fixed, greedy method:

1. Code-map takes the first pair that no case covers yet, in the order of the conditions and of their values.
2. Code-map gives each other condition, in order, the value that covers the most uncovered pairs with the values chosen so far.
3. On a tie, Code-map takes the value with the most uncovered pairs in total, and then the first such value.
4. Code-map repeats these steps until each pair is in a case.

The same table always gives the same cases.

A decision rule can also name an `oracle` object with `file`, `suite`, `name`, and `criterion`.
The fields select a human oracle record. `suite` can be null.
The harness reports confirmation and test-digest freshness for each rule. See [trusted rows](harness.md#decision-table-mode).
Static validation accepts the reference but does not confirm it.

## Limits for model files

A model file is untrusted input. Code-map refuses these files and lists each one in `models.errors` with its `reason`:

| `reason` | Meaning |
| --- | --- |
| `invalid` | The file breaks a rule of its kind. `problems` names each problem with its path |
| `not-json` | The text is not valid JSON |
| `too-large` | The file is larger than 256 KiB |
| `too-many-files` | The file is after the first 50 files of its folder, in the order of the paths |
| `symbolic-link` | The file or the folder is a symbolic link. Code-map reads no link, also when it points inside the repository |
| `outside-repository` | In a working tree: the file or the folder is a link, and its real path is outside the repository. Code-map does not read the target |
| `not-a-folder`, `not-a-file`, `unreadable` | The model folder is a file, the model file is not a regular file, or Code-map cannot read it |

Code-map checks model paths and limits before it loads their JSON text.
Code-map reads only the `.json` files directly in each folder. It ignores other files and the files in subfolders. It reads the files of the mapped snapshot: the files of the commit, or the files of the working tree that Git does not ignore.

## Model files, the analysis ID and the settings

A model file is part of the code, not a setting. Code-map reads it from the mapped commit or from the working tree, as it reads a source file. Thus:

- For a commit, the commit SHA identifies the model files.
- For a working tree, the content hash of each changed JSON file is part of the analysis ID. A model edit gives a new analysis ID, and the old analysis is stale with the reason `worktree`.
- A model file is not in the settings digest (`config`), and `code-map verify` does not count it as a settings file.

## What Code-map does not check

- Static inspection runs no case. The [restricted harness](harness.md) runs bounded model cases with a user authorization.
- Code-map reads only literal values. A limit that comes from a constant, such as `.min(MAX)`, is UNKNOWN.
- Code-map reads the Zod types `number`, `int`, `string`, `array`, `enum` and `object`. It does not read `union`, `tuple`, `record`, `date`, `bigint` or `z.custom()`. A check on a parent object, such as `.refine()` on `z.object()`, does not change the expected result of a field.
- A schema must be held by a variable. Code-map does not read a schema that is an argument of a call or the value of `export default`.
- A test links to a model only when it imports the file of the model directly. A test that imports the schema file through another file does not count.
- In an XState machine, Code-map does not read guards, actions, history states or the `types` of `setup`. A guarded transition counts as a transition. A history state is UNKNOWN.
- A declared model and an XState machine are separate models. Code-map does not compare them.
- `code-map verify` reads models for bound trace information. The models block gives no finding and no rating.
- The HTML page does not show the model report.

## Observed XState transitions

An observed transition is a machine ID, source state, event and target state recorded during an authorized test command.
Use `authorize --trace-xstate --command node --test`, then `run --trace-xstate --authorization <id> -- node --test`.
The authorization stores the exact Node command with `--import ./.code-map-xstate/preload.mjs`.
An authorization for the plain command cannot enable tracing.

The preload wraps public ESM `createActor` and CommonJS `interpret` calls from the installed `xstate` package.
XState 5 inspection records event snapshots and intermediate microsteps. XState 4 uses transition subscriptions.
CommonJS default namespaces and repeated require identity remain stable.
Generated timer and completion event names match the corresponding extracted transition kinds.
The worker retains `.code-map-xstate/trace.jsonl` as artifact kind `xstate-trace`, with its signed run manifest.
It stores no event payload or context data. Trace mode accepts direct Node commands and owns the run's artifact slot.

Use `inspect --summary --worktree --run <run ID>` to compare a stored trace with the selected snapshot.
The `xstateTrace` block reports binding, signature and `information`. A stale trace has null information.
In `verify`, add `{ "run": "<run ID>" }` to `reportInputs`.
Bound trace information lives in `executions[].xstateTrace`. Neither rule set uses it as a check.

The comparison lists `models[].unseen`, `unauthorized` observations and `unhandled` events.
A declared model matches its `name`. An extracted XState model matches its explicit machine `id`.
Duplicate identities and incomplete models give UNKNOWN comparisons.
Single-branch nested values use dotted state paths. Parallel values give UNKNOWN.
A transition on a parent state also covers its descendants.
The parser accepts at most 100,000 JSON-line records and 50 MiB.

Without XState, the artifact reports UNKNOWN with a reason. Unsupported values also retain an UNKNOWN reason.
An unchanged state counts as unhandled when no declared transition matches. Inspection can also report no selected transition.
Guard predicates and action effects remain outside the comparison.
Unseen means absent from this run. It does not mean unreachable or impossible to test.
Project code can alter its own trace. The worker binding authenticates the snapshot, not the truth of project reports.
Imports through private package subpaths and processes that discard the preload remain outside this instrumentation.

## Integer range boundaries

Inspection reads scalar integer ranges from `*.schema.json` files and JSDoc annotations on declarations.
JSON Schema supports `type: "integer"`, `minimum`, `maximum`, `exclusiveMinimum` and `exclusiveMaximum`.
The JSDoc convention uses `@minimum`, `@maximum`, `@exclusiveMinimum` and `@exclusiveMaximum` with integer literals.
Each annotated declaration describes one scalar integer input. Export the validator for authorized execution.
For example, `/** @minimum 18 @maximum 65 */` declares inclusive age bounds.
Each bound produces n-1, n and n+1. Every bound participates in each expected result.
Limits range from -1000000000 to 1000000000. Unsupported JSON constraints and invalid annotations give UNKNOWN.
Array and object boundary construction is outside this integer adapter.
Use [boundary harness modes](boundary-harness.md) to compare actual validator outcomes.
