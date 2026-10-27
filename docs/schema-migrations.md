# SQLite fixture migrations

Use this spec to apply changed SQL migrations to a known fixture database:

```json
{
  "harnessVersion": 1,
  "mode": "migrate",
  "base": "main",
  "fixture": "fixtures/before.sql",
  "assertions": [{ "query": "SELECT id FROM users ORDER BY id", "rows": [{ "id": 2 }] }]
}
```

`base` selects the comparison commit. `fixture` names SQL in the selected head snapshot.
Optional `package` selects a package folder. Its default is the repository root, written as an empty string.
This mode has no `subject` and needs no project loader.
Code-map detects Prisma datasource `provider = "sqlite"`, Drizzle `sqliteTable` definitions or explicit SQLite SQL snapshots.
Read [SQL snapshots](retrieval.md#explicit-sql-snapshots) for filenames and dialect markers.
Other databases and incomplete database definitions give UNKNOWN with a reason.
Unsupported migration-folder configuration also gives UNKNOWN. The harness does not guess its files.

The restricted worker uses `node:sqlite` from Node.js 22.5 or later.
It creates an in-memory database, enables foreign keys, and applies the fixture first.
It then applies new or edited migration files in lexicographic path order.
Removed or moved historical migration files give UNKNOWN. Their deployment effects need separate review.
The fixture must include the base schema and representative data. Earlier migrations do not run automatically.
Migration folders follow the [schema discovery rules](retrieval.md#where-code-map-finds-the-schemas).
SQL files have a 1 MiB limit. A run accepts one through 100 changed migration files.
File operations, including ATTACH and VACUUM, are refused. SQL containing those words is also refused conservatively.
The worker authorization supplies the time, memory and output budgets. `callTimeoutMs` does not limit SQL statements.

After migration, `assertions` compare read-only SELECT results with declared `rows`.
Use ORDER BY when row order matters. Object key order does not matter.
Each assertion retains its query, expected rows, actual rows and PASS or FAIL.
A value mismatch or row-count mismatch gives FAIL. Successful SQL without assertions gives UNKNOWN.
Assertions declare the data oracle. They do not authenticate a reviewer or prove its correctness.
Each run accepts at most 100 assertions. Each query has at most 10000 characters.
Each result has at most 1000 rows and 200000 bytes. The declared assertions share a 200000-byte limit.
Use JSON scalar cells. Write queries and file functions are refused. The database is read-only during assertions.
The artifact has `migration.status`: PASS, FAIL or UNKNOWN.
`before` and `after` list each main-database user table and its row count.
Temporary tables are outside these counts. Removed tables appear only in `before`.
`applied` lists completed files. `failedFile` and `error` identify an SQL failure.
`reason` explains UNKNOWN. SQL errors stop further migrations and retain counts after partial execution.
Counts cover at most 500 tables. Fixtures do not prove correctness for production data or deployment sequences.
Bound runs expose this object as `executions[].harness.migration` in verification results.
This information adds no check to either rule set.
