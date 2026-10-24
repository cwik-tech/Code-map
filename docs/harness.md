# Run a bounded harness

A harness calls a project export or applies SQLite fixture migrations. Code-map writes its fixed script into the restricted worker workspace.
Each call receives one input argument. For several arguments, export a wrapper that accepts an array or object.

The harness never runs project code on the host. Every run needs an authorization for these exact command words:

```sh
node .code-map-harness/runtime.mjs
```

A person creates the authorization with `code-map authorize`. An agent must not create an authorization for itself.

```sh
code-map authorize --command node .code-map-harness/runtime.mjs
code-map harness --authorization AUTH-0123456789abcdef --spec harness.json
```

Replace the example ID with the ID from `authorize`. See [worker isolation and authorization](run.md) for its limits.
Without a working sandbox backend, Code-map refuses the run.
The reserved `.code-map-harness` folder must not exist in the snapshot.

## Select the snapshot

The default head is `HEAD`. Use `--head <ref>` for a commit, or `--worktree` for current files.
Use `--store <folder>` for the store of the authorization. `--compact` removes JSON indentation.
The spec file must resolve inside the repository. Code-map reads at most 256 KiB.
The spec is control input. It can remain untracked when the subject runs from `HEAD`.
Corpus and model files must exist in the selected snapshot.

## Write the spec

Every spec has these fields. Unknown fields are errors, including fields from another mode.

| Field | Value |
| --- | --- |
| `harnessVersion` | `1` |
| `subject` | `{ "file": "src/subject.mjs", "export": "subject" }`. Absent in `migrate` mode |
| `mode` | `differential`, `property`, `fuzz`, `decision-table`, `state-model`, `zod-boundaries`, `fault`, `route` or `migrate` |
| `callTimeoutMs` | Optional integer, 10 to 30000. Default: 1000 |

Paths are relative to the snapshot root. They cannot contain `..`, empty components, backslashes or drive prefixes.
The harness refuses subject and input links that resolve outside their snapshot.
JavaScript subjects need no loader.
A TypeScript subject needs the project's declared and installed `tsx` loader.
Alternatively, name a compiled JavaScript file as the subject. Code-map does not compile the project.
Node's automatic TypeScript stripping does not bypass this requirement.

### Migrate mode

Use `mode: "migrate"`, `base` and `fixture` for restricted SQLite transforms. This mode has no subject.
Optional `package` selects a package folder. Read [fixture migrations](schema-migrations.md) for the complete specification and limits.

### Differential mode

```json
{
  "harnessVersion": 1,
  "subject": { "file": "src/price.mjs", "export": "price" },
  "mode": "differential",
  "base": "main",
  "inputs": "cases.json",
  "ignoreFields": ["id", "createdAt"]
}
```

`cases.json` contains a JSON array, such as `[{"quantity":1},{"quantity":2}]`.
The array has at most 10000 inputs. Its file has at most 256 KiB.
Code-map copies the base commit into a second workspace tree inside the sandbox.
Both trees use the worker's head dependency installation. The run does not install historical dependencies.
Each input runs once in each tree. The report records every output or error difference.
A hang always gives a difference, even when both trees hang.
The report records the base commit, the SHA-256 digest of the exact corpus bytes, and the normalization.
`ignoreFields` removes matching object field names at every depth. It does not use dotted paths.
Durations do not participate in comparison. Side effects participate in comparison. See [side effects](#side-effects).

### Property mode

```json
{
  "harnessVersion": 1,
  "subject": { "file": "src/price.mjs", "export": "price" },
  "mode": "property",
  "seed": 42,
  "count": 100,
  "generator": { "type": "integer", "min": 0, "max": 100 },
  "invariant": { "file": "src/price.mjs", "export": "nonnegative" }
}
```

The invariant receives `(input, output)` and must return a boolean. An asynchronous invariant is supported.
The run stops at its first failure. `count` records the requested count. `executed` also includes shrink calls.
The report retains the original input, the shrunk input, the seed, and the shrink attempt count.
Shrinking tries at most 100 candidates. It preserves declared ranges.
Numbers move toward zero or their nearest range endpoint. Strings and arrays get shorter.
Object fields shrink separately. The run folder receives regression data and a test skeleton. See [regression fixtures](#regression-fixtures). This is a small shrinker, not a proof of a globally minimal counterexample.

### Generators

The generator version is `mulberry32-v1`. The seed is an integer from 0 to 4294967295.
Generation never uses `Math.random()`. Repeating a seed reproduces the generated input sequence.

| `type` | Required fields |
| --- | --- |
| `integer` | Integer `min` and `max`, from -1000000000 to 1000000000 |
| `string` | `minLength`, `maxLength`, and nonempty `alphabet` |
| `boolean` | None |
| `array` | `minLength`, `maxLength`, and generator `items` |
| `object` | `properties`, an object whose values are generators |

Lengths range from 0 to 100. An alphabet has at most 256 UTF-16 code units.
An object has at most 20 properties. A generator has at most 100 schema nodes and six nesting levels.
One generated input has at most 10000 values.

### Fuzz mode

Use `generator`, `seed`, and `timeBudgetMs`. The time budget ranges from 10 to 300000 milliseconds.
Optional `allowedErrors` lists error class names that do not count as crashes. The default list is empty.
Optional `corpus` is an inline JSON array of at most 100 inputs and 256 KiB of serialized UTF-8 JSON.
Each input must match the generator, including ranges, lengths, alphabet, array items, and exact object fields.
Each corpus input has at most 10000 values. Code-map refuses invalid corpus inputs before it starts the run.
The run calls corpus inputs in array order before generation or mutation. All calls share the time budget and 10000-call limit.
A hang, UNKNOWN result, or exhausted budget can stop the run before it calls the complete corpus.
`calls[].source` identifies `corpus`, `generated`, or `mutation` inputs. `parameters.corpus` keeps the declared initial inputs.
The report's `corpus` object describes retained discoveries, separate from the initial array.

Optional `invariant` names a file and export, as in property mode. It receives the input and returned output.
The invariant runs in the same restricted subprocess and shares the call timeout and run budget.
A false result adds an `invariant` failure with the input and result. It does not count as a crash or hang.
A true result adds no failure. An exception or nonboolean invariant result gives UNKNOWN.
The run checks invariants for corpus, generated, and mutated inputs. Subject exceptions do not invoke the invariant.

A thrown error outside that list is a crash. An abnormal subprocess exit is also a crash. A call that exceeds `callTimeoutMs` is a hang.
Code-map terminates that call and stops the fuzz loop after the hang.
If the remaining fuzz budget expires first, the report sets `budgetExhausted`. It does not claim a per-call hang.
The run also stops after 10000 calls. Worker startup and cleanup add overhead to the time budget.
The corpus retains inputs with new executed V8 blocks or new outcome classes.
Outcome classes include error classes, output types, and sets of touched paths and change kinds.
After the initial corpus, every second input mutates a retained seed. Other inputs come from the declared generator.
The report gives `corpus.size`, `corpus.classes`, retained `corpus.seeds`, and the mutation count.
The seed reproduces the input sequence for the same outcomes. A time budget can change the sequence length.
Each call uses `node:inspector` precise block counters inside the worker subprocess.
Counters start after module loading and stop when the subprocess drains its event loop.
Only the declared subject file contributes. Imported files and module initialization do not contribute.
Block identities use the subject path and executed V8 range fragments after subtracting nested ranges.
V8 coalesces equal counters. Counts describe these fragments, not a fixed percentage of source branches.
TypeScript offsets refer to the loaded script. Engine versions can change range boundaries.
`corpus.blocks` lists covered identities. `corpus.classes` lists unique outcomes, independently of the retained seed count.
`coverage.coveredBlocks` gives the cumulative count. `coverage.history` records each call, elapsed milliseconds, covered blocks, and corpus size.
Each call and run retain at most 10000 blocks. Existing output caps also apply.
A coverage collection failure gives UNKNOWN. A terminated call has no complete block measurement.
Block coverage is not path coverage. It does not prove assertions, behavior, or safety.
An unhandled rejection outside `allowedErrors` counts as a crash, including when the subject returns normally.
Each crash gets regression data and a test skeleton in the run folder.
Every fuzz report says `finite: true`. A finite run cannot prove that all inputs are safe.

### Decision-table mode

Use `table` to name a [decision-table file](models.md). Its subject must match the harness subject.
Each call receives one object with the condition values. Code-map compares its output with `then`.
Gaps and conflicting outcomes give UNKNOWN results. They do not count as passes.
The table reader enumerates all combinations up to 4096. Larger tables use its deterministic pairwise cases.
The report records the method and the full combination count.
Each rule can name an `oracle` reference with `file`, `suite`, `name`, and `criterion`.
These fields select an existing human record in `.code-map/oracles.json`.
The report lists each rule in `rows`, with `confirmed`, `current`, and the referenced record.
A missing record is unconfirmed. A test digest mismatch makes the record stale.
A reference declares that the test oracle supports the rule. Code-map does not prove that semantic connection.
Code-map never creates human confirmations. See [oracle records](verify.md#human-oracle-records).

### State-model mode

Use `model` to name a [declared state-model file](models.md). The subject must export an XState machine.
Code-map sends each declared event from its declared source state and compares the target state.
It uses XState 4's machine transition API or XState 5's exported pure transition API.
A missing package or unsupported API gives UNKNOWN with a reason.
These are independent transition calls. They do not prove an event sequence, effects, or application integration.

### Zod boundaries mode

Set `mode` to `zod-boundaries`. The subject names an exported schema found by the static Zod extractor.
No generator or corpus field is required.
Code-map calls the schema's `safeParse` with each constructed boundary input inside the worker.
It compares the boolean `success` with the extracted `expected` constraint result. A difference is a `mismatch`.
The report keeps each input, field path, boundary descriptor, expected result, and actual call result.
Numbers and enums use their literal values. String lengths become repeated `x` characters, up to 10000 characters.
Simple scalar objects use a valid candidate for each other constrained field.
Arrays, nested objects, incomplete constraints, and oversized strings give UNKNOWN cases.
Unconstrained required object fields and object-level refinements are not inferred. They can cause mismatches that need review.
This adapter checks the schema API. Qualification against an installed Zod version needs that project's dependencies.

### Fault mode

Use these fields:

```json
{
  "harnessVersion": 1,
  "mode": "fault",
  "subject": { "file": "src/client.mjs", "export": "request" },
  "inputs": "cases.json",
  "fault": "hang",
  "mustHandle": true,
  "callTimeoutMs": 1000
}
```

`inputs` contains at most 10000 inputs. Each call receives one value.
`fault` is `reject`, `hang`, or `status`. These replace `globalThis.fetch` before the subject module loads.
`reject` throws a TypeError. `hang` stays pending and respects the supplied AbortSignal.
`status` returns a Response with an error status. Optional `status` ranges from 400 to 599. Its default is 503.
The required boolean `mustHandle` declares whether escaping errors violate the spec.
An observed fetch hang past `callTimeoutMs` gives `missing-timeout`.
An escaping error or unhandled rejection gives `escaped-error` when `mustHandle` is true.
A call without an observed fetch gives UNKNOWN. A timeout before fetch also gives UNKNOWN.
An error status alone does not prove failure. The report retains the subject's output for review.
Only global fetch is injected. Other clients, retries, application recovery, and full critical paths need separate tests.

## Side effects

Each call records `effects.stdout`, `effects.stderr`, `effects.rejections`, and `effects.files`.
Output streams share the existing 256 KiB cap. Exceeding it stops the call and gives UNKNOWN.
Rejections retain bounded error names and messages until the subprocess drains its event loop.
A bounded event pipe retains observed rejections even when a call later hangs or crashes.
The event pipe accepts at most 1 MiB. The rejection list keeps at most 100 entries. A timeout can end observation before pending rejections occur.
File records give a relative path, change kind, and before/after descriptors with digests.
Snapshots exclude entries named `.git`, `node_modules`, and `.code-map-harness`.
They inspect at most 10000 entries, 30 levels, 1 MiB per file, and 32 MiB of file bytes.
An unsupported file type or incomplete snapshot gives UNKNOWN.
Links record their target text. Code-map does not follow them.
Differential comparison omits raw file digests and compares normalized content digests instead.
JSON file contents use the same recursive `ignoreFields` normalization as outputs.
Other files and console text compare exact bytes. Durations do not participate.
These snapshots observe final state. They cannot detect transient writes that a call reverses.
The workspace persists between calls. Subject code can leave files for later calls.

## Regression fixtures

For property failures and fuzz crashes, the stored run folder receives `fixtures/case-NNNN.json` and `case-NNNN.test.mjs`.
Property data uses the shrunk input. Crash data uses the original crash input.
The JSON also retains the subject, seed, generator version, and failure details.
The test skeleton uses `node:test`. It stays skipped until a person supplies a subject import and reviewed assertion.
Copy both files into your test folder. Replace the skipped body with a call using `fixture.input` and your expected outcome.
Code-map never copies these files into your repository. Fixture files are derived convenience data, outside the report manifest digest.

### Route mode

```json
{
  "harnessVersion": 1,
  "mode": "route",
  "subject": { "file": "app/items/[id]/route.mjs", "export": "GET" },
  "contract": "openapi.json",
  "path": "/items/{id}",
  "callTimeoutMs": 3000
}
```

`contract` names an OpenAPI JSON document in the selected snapshot. `path` selects its documented path.
The worker imports the route module and calls each exported HTTP method with a real `Request`.
The required subject export field retains the common spec format. Route mode discovers all exported HTTP methods.
Path, query and header parameters use explicit `example` or `examples.*.value` data.
Path parameters also enter the handler context as the `params` promise.
A literal server URL adds its path prefix. Server variables give UNKNOWN.
A JSON request body uses the media type's example. Required examples that are absent give UNKNOWN.
Status codes must match a declared response, status range or default response.
Request examples must satisfy their declared schemas before execution. Invalid examples give UNKNOWN.
Responses check required fields, scalar types, nested objects, array items, enum, const, numeric bounds and length bounds.
Extra fields fail only when `additionalProperties` is false. Unsupported rules give UNKNOWN.
Read [OpenAPI execution rules](contracts.md#openapi-execution-rules) for the supported subset.
References, composed schemas and unsupported parameter forms give UNKNOWN.
A route export group runs in one fresh subprocess. Its timeout covers every method and response body.
A thrown method records a problem and does not prevent the remaining methods from running.
Each method has one request example. Response streams stop above 256 KiB.
The report retains checks and problems, without retaining response bodies.
JavaScript needs no loader. TypeScript requires the project's installed `tsx` loader, as other harness modes do.
No server starts. Framework middleware, routing and deployment behavior are outside this check.


## Read the results

The CLI prints the run summary. The stored `stdout.log` contains one JSON line per call.
Project logs do not enter that protocol. Each call result includes its duration in milliseconds.
The stored artifact is `harness.json`. The manifest binds its digest to the head snapshot with `environment.policy: "isolated"`.

Values use stable JSON. Object keys have deterministic order. Ordinary objects use `{ "$type": "object", "value": ... }`.
Undefined values, nonfinite numbers, negative zero, big integers, dates, and error values have distinct tags.
Thrown errors retain their class name and message. Cycles and unsupported values give UNKNOWN results.
Setup, normalization, and result-protocol failures give UNKNOWN results. Matching UNKNOWN results cannot give a clean differential run.
A call has at most 10000 normalized values, 30 levels, and 256 KiB of output.
A string has at most 65536 characters. Subject logs have a separate 256 KiB limit per call.
The run retains at most 20000 call records, 8 MiB of call data, and a 16 MiB report.
The worker's authorization budgets can stop the whole run earlier. A stopped worker keeps no artifact.
A harness process failure also gives no usable artifact. Read the run problems and stderr.
The CLI exits with 0 when the worker keeps the artifact, including a report with behavioral failures.
It exits with 1 for a refused run, a stopped run, or collection failure. Inspect the artifact for behavioral outcomes.
Each call uses a fresh subprocess, with a 128 MiB old-generation heap limit.
Module state resets between calls. Each subprocess starts in its own snapshot root.

Add the run to a verification request:

```json
"reportInputs": [{ "run": "R-20261023T120000Z-0123abcd" }]
```

Use the same store for `harness` and `verify`. Bound harness results appear under `executions[].harness` and in the report.
They are information only. They change no check, rating, threshold, or readiness rule in `static-baseline-v0`.
The sandbox restricts access. It does not prove that project code or a project-defined invariant tells the truth.

The [evidence-v1 rule set](verify-evidence-v1.md) uses other bound harness outcomes in an optional check.
Migrate observations stay outside that check.
An isolated differential run of at least twenty paired inputs can confirm refactor preservation.
The differential base must match the verification base. A failed optional harness check prevents READY without blocking.

Read [JSON Schema and range boundaries](boundary-harness.md) for integer validator runs.
