# JSON Schema and range boundaries

Use `mode: "json-boundaries"` with a repository-relative `schema` path and a validator function as `subject`.
Use `mode: "range-boundaries"` with an annotated validator function as `subject`.
Each validator receives one scalar integer and returns a boolean acceptance result.
Read [integer range boundaries](models.md#integer-range-boundaries) for the constraint convention.
The worker compares each returned boolean with the independently extracted expected result.
Unsupported constraints give UNKNOWN and do not run as passing cases.
`boundaries.cases` retains inputs, expected outcomes and boundary descriptors.
`boundaryResults` links each case index to its call index and actual boolean, or null for an unavailable result.
The run manifest binds this artifact to its run identity and snapshot.
The report reader rejects invalid call links. Static names alone never prove execution.
