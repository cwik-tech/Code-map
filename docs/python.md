# Scan Python code

Code-map reads Python 3 source files with the standard-library `ast` parser.
It also scans repositories that contain TypeScript, JavaScript and Python.
It never imports or runs a project module.

## Interpreter

Install Python 3.8 or later before a scan.
Code-map does not install Python or Python packages.

Set `CODE_MAP_PYTHON` to select an absolute interpreter path.
This environment variable takes precedence over the repository setting.
A relative value produces an UNKNOWN Python gap.

The `python.interpreter` setting in `.code-map.json` accepts only `python3` or `python3.<minor>`.
For example:

```json
{
  "python": { "interpreter": "python3.14" }
}
```

Code-map refuses setting paths and other program names without execution.
The UNKNOWN Python gap names the refused setting and explains the accepted format.

For a command name, Code-map searches only these folders:

- Absolute folders on `PATH`
- `/opt/homebrew/bin`
- `/usr/local/bin`
- `/Library/Frameworks/Python.framework/Versions/*/bin`
- `/usr/bin`

Code-map skips relative `PATH` entries, including empty entries and `.`.
Without an explicit selection, Code-map selects the newest Python 3.8+ interpreter in these folders.
Discovery accepts only `python3` and `python3.<minor>` executable names.

Code-map resolves each candidate with `realpathSync` before execution.
It refuses every real path inside the scanned repository, including targets of external symlinks.
This rule also applies to `CODE_MAP_PYTHON`.
If no usable candidate remains, the UNKNOWN Python gap includes the refusal reason.

The cache key includes the repository real path, setting, environment selection, `PATH`, folders and candidate identities.
Candidate identities include real paths and file metadata, so changed links and executables invalidate the cache.
The analysis and summary record the interpreter path, version and `source` in `python.interpreter`.
The source is `environment`, `setting` or `discovery`.
The snapshot identity includes the same interpreter record.
Interpreter differences make snapshot comparisons UNKNOWN.
Without a usable interpreter, `.py` files remain in `unsupportedFiles`.
The summary includes a Python gap with the reason.

## Source roots and imports

The repository root and `src/` define module names.
Code-map also reads these package layouts from `pyproject.toml`:

- Setuptools `package-dir` and `packages.find.where`
- Poetry `packages` entries with `from`
- Hatch `build.packages` and `build.targets.wheel.packages`

The `roots` setting takes precedence.
Package folders work with or without `__init__.py`.
Relative imports use their leading-dot level.
Absolute imports use module names below each root.

An import of a missing local module produces `IMPORT-UNRESOLVED`.
An absolute name counts as local when its first segment names a repository package.
Standard-library imports use the interpreter's module list.
Python 3.8 and 3.9 use a fixed standard-library list.
Other imports count as third-party imports.
An import in a protected `try` body has `optional: true` on its import edge.
The handler must catch `ImportError`, `ModuleNotFoundError`, `Exception` or `BaseException`.
A tuple that contains one of these names also counts.
A bare `except` also counts.
An unresolved optional local import produces no `IMPORT-UNRESOLVED` finding.
The Python report counts these import statements in `optionalUnresolvedImports`.
Imports in an unprotected handler, `else` or `finally` stay required.
A resolved import retains its edge unless the target is the source file itself.
Self imports produce no self cycle.
Cycles between two or more files remain visible.

The shared graph provides importers, impact, cycles, hotspots and test links.
Python files contribute to the summary and the offline map.
A `Python` completeness row counts discovered, supported, parsed, skipped and malformed files.
It also counts unresolved dynamic imports.

## Packages and entry points

Python package checks share the package report, findings and evidence gaps with JavaScript.
Code-map reads declarations as text from these files:

- `pyproject.toml`: project dependencies, optional dependencies, dependency groups, Poetry groups and uv development dependencies
- `requirements*.txt` and `requirements/*.txt`, including repository-local `-r` and `-c` includes
- `setup.cfg`: install requirements and extras
- `setup.py`: literal requirements and entry points in `setup(...)` calls
- `Pipfile`: packages and development packages

Requirements constraints limit versions. They do not declare dependencies.
Includes stop at cycles and at depth 16. They never fetch a URL.
Options, URLs, editable projects and local paths appear in the skipped list.
Computed setup values and unavailable includes stay UNKNOWN.
`uv.lock`, `poetry.lock` and `Pipfile.lock` supply distribution names only.
A lock file never declares a dependency.
Distribution names use PEP 503 normalization.
Production imports of dependencies declared only in development groups produce `PACKAGE-DEV-ONLY` leads.

Import names use distribution-name identity with hyphens replaced by underscores.
A short exception table also recognizes these mappings:

| Distribution | Import names |
| --- | --- |
| PyYAML | yaml |
| Pillow | PIL |
| scikit-learn | sklearn |
| beautifulsoup4 | bs4 |
| python-dateutil | dateutil |
| opencv-python | cv2 |
| protobuf | google.protobuf |
| attrs | attr, attrs |
| pyjwt | jwt |
| python-dotenv | dotenv |
| pywin32 | win32api, win32com, win32con, pythoncom, pywintypes |

Code-map also reads `top_level.txt` and `RECORD` in local virtual environments.
It checks `.venv`, `venv`, `env` and root folders with `pyvenv.cfg`.
A commit scan reads this metadata from the working folder.
It never starts an environment interpreter or loads startup hooks.
It refuses symlink paths.

A required third-party import with a known distribution name and no matching declaration produces `PACKAGE-UNDECLARED`.
An import with no distribution-name evidence stays UNKNOWN.
Local modules and standard-library modules do not count.
Optional imports, platform-conditional imports and `TYPE_CHECKING` imports produce no package finding.
Literal `pytest.importorskip` calls protect matching later imports in their scope.
Code-map keeps an import UNKNOWN when a `unittest.mock.patch.dict` context manager can replace its `sys.modules` entry.
Without declarations, the check records a gap instead.
Incomplete declarations keep unmatched imports UNKNOWN.

A main dependency with no import, entry-point reference or configuration use produces `PACKAGE-UNUSED`.
Tool distributions, pytest and Flake8 plugins, type stubs and named build back ends do not produce unused leads.
Computed loaders and incomplete inputs keep uncertain use UNKNOWN.
These results are static leads. Distribution aliases outside the table and environment metadata remain a limit.

Entry points include declared scripts, GUI scripts and plugin targets.
They also include package `__main__.py` files, top-level main guards, named tool files and files in `scripts` or `bin`.
The shared path scanner reads literal Python commands, module starts, uv file starts and pytest plugin starts.
It reads workflow files, shell scripts, Makefiles, Dockerfiles, tox settings and package scripts.
Django model, settings, routing, app and migration files count when the project declares or imports Django.
Alembic environment and version files count when the project declares or imports Alembic.

A Python source module with no importer or entry point produces `FILE-ORPHANED`.
Package initializers never produce this lead.
Dynamic import prefixes protect matching modules and their submodules.
Computed plugin loaders, file-based module loaders, resource walks, `sys.path` changes, unresolved entry declarations and configuration module strings keep reachable files UNKNOWN.
The package report lists each reason under `unknown.orphans`.

Packaging inputs have limits of 512 files, 1 MiB per file and 8 MiB total.
Requirement traversal stops after 1,024 path and group combinations.
Environment metadata has limits of 2,048 files, 1 MiB per file, 8 MiB total and 4,096 folders.
It also stops after 4,096 entries in one directory.
Each isolated packaging parser call has a 15 second limit and a 4 MiB output limit.
Python 3.11 and later use `tomllib`.
Older interpreters use a bounded literal TOML reader.
Unsupported TOML stays UNKNOWN.

## Test inventory

The default pytest file patterns are `test_*.py` and `*_test.py`.
Code-map reads `testpaths` and `python_files` from these files:

- `pytest.ini`, section `[pytest]`
- `pyproject.toml`, section `[tool.pytest.ini_options]`
- `setup.cfg`, section `[tool:pytest]`

File patterns apply throughout the repository, including files outside `testpaths`.
Each Python test file has `defaultCollected` in its scan and report inventory.
This flag is true inside `testpaths`, or when no `testpaths` are set.
It describes configured path membership, not observed pytest execution.
A `conftest.py` is a helper and never a test file.
A Python file that the parser reads never produces `TEST-UNREADABLE-FILE`.

Code-map records test functions, methods in `Test` classes and `unittest.TestCase` methods.
Assertions include `assert` statements and `.assert*` method calls.
They also include calls to `pytest.raises`, `pytest.warns`, `pytest.deprecated_call` and `pytest.fail`.
These calls count inside `with` items too.
Pytest module aliases and direct function imports retain this recognition.
Code-map follows calls to assertion helpers in test files, `conftest.py` and modules that only tests import.
It maps helper parameters to the arguments of each call.
Unchecked expected operands give no failure credit for the functions that produce them.
An unused helper body gives no assertion credit.
A fixture parameter gives no assertion credit for the fixture body.
A factory fixture counts only when a test calls its literal returned helper.
Each case has a suite, name, line and static status.
`skip` produces `skipped`, and `skipif` produces `conditional`.
`xfail` produces `expected-failure`.
Literal `parametrize` rows provide a row count in `each`.
The inventory counts each parameterized function once.
Computed parameter values have an unknown row count.

Test files link to source modules through direct and transitive imports.
A link does not prove execution or an assertion about the module.
Phase 1 does not collect tests through pytest plugins or custom hooks.

## Failure paths

Python functions and methods record `raise` as `throw` exits.
Each `except` handler records one `catch` exit at its first statement.
Raises inside that handler add no second exit, as for TypeScript catches.
A nested function starts a separate scope.
Top-level declaration ranges also summarize the exits of their nested functions, as for TypeScript.
Calls to `sys.exit`, `exit`, `quit` and `os._exit` count with a non-zero or non-literal status.
`os.abort()` also counts.
Production `assert` statements do not count as failure exits because `python -O` removes them.

Failure assertions include context and callable forms of `pytest.raises`, `self.assertRaises` and `self.assertRaisesRegex`.
An `except` block that asserts on its caught error also counts.
Positive error-value checks, false success flags and failing status checks also count.
These assertions use the shared `throws`, `error-value`, `ok-false` and `status` kinds.
A null error, a true success flag or a success status gives no failure credit.
Each failure assertion names the declarations in its checked block or callable operand.
`pytest.warns` and `pytest.fail` count as assertions, with no failure kind.
The shared C09 leads use these targets and the references of each function and case.
The public-function checks use the existing `exported` flag.
The failure-exit checks also include internal functions, as for TypeScript.
C27 reports swallowed assertions and literal `time.sleep` calls in test bodies.
A swallowed-assertion lead needs a handler that catches `AssertionError`, `Exception` or `BaseException`, or a bare handler.

Static references follow local names, explicit imports, explicit base classes and stable local aliases.
Literal dictionary keys retain the references of their value origins.
Star imports, `getattr`, non-literal keys and ambiguous assignments give no resolved reference.
Helper expansion stops at four call levels, 32 distinct helpers and 256 KiB per helper module.
Operand origins stop after two alias steps.
Recursive helper calls stop at the active call boundary.
Reaching a function is static evidence and does not prove execution.

## Public names and signatures

A literal `__all__` list or tuple selects the public names of a module.
Literal `+=` and `__all__.extend([...])` add names.
A computed value or another mutation leaves public names UNKNOWN.
Conditional declarations without a known unconditional binding stay UNKNOWN.
A name in `__all__` without a definition or import stays UNKNOWN and is not an export.
Without `__all__`, public names are top-level definitions and assignments without a leading underscore.
Imports stay private, except the explicit re-export forms `from x import y as y` and `import x as x`.
Methods belong to a class signature and are not module exports.
Package `__init__.py` files form public API surfaces.
Their named re-exports follow the declaring module.

Signatures retain parameter names, kinds, defaults and source annotations.
They include return annotations, async functions and call-form decorators.
Class signatures include bases, constructors, public methods and annotated fields.
Dataclass options stay as source text.
NamedTuple, TypedDict and model class fields retain their annotations and defaults.
Code-map does not inspect Pydantic constraints here.
Overload declarations form one export with several signatures.
Adjacent `.pyi` files take precedence for signatures.
A matching module in a `<name>-stubs` folder also supplies signatures.
Each overridden signature records its stub path in `signatureSource`.
Stub-only modules also join the source graph.
Stub edits change the snapshot identity.

`inspect --base <ref>` compares Python exports with the base snapshot.
The API pages report REMOVED, CHANGED, UNKNOWN and ADDED names and follow Git file renames.
Removed or changed names list consumers, including imports through package re-exports.
Removed parameters, keyword parameter renames, new required parameters, stricter parameter kinds,
removed defaults and changed annotations produce signature leads.
New optional trailing parameters and optional keyword-only parameters remain compatible.
Annotation comparison uses source text and is not a type check.

The impact call pages bind imported names to Python call facts.
They check positional counts, keyword names and missing required arguments.
Spread arguments, variadic signatures, `getattr`, unresolved aliases and shadowed bindings stay UNKNOWN.
Custom `__new__` methods, metaclasses and incomplete inherited dataclass fields also stay UNKNOWN.
The call summary counts these UNKNOWN sites separately.
`verify` includes Python API changes, call sites and unknown modules in `pythonApi`.
These observations do not change the rule sets or ratings.
External consumers remain outside the scan.

The existing export findings now use Python names.
`EXPORT-UNREFERENCED` and `EXPORT-TEST-ONLY` remain static leads.
An entry point or a source import suppresses these leads for the names it uses.
`TEST-EXPORT-CANDIDATE` reports a public function without a static test relationship.
Cases without function reference facts keep candidate status.
Module imports alone do not close these candidates.
A relationship never proves execution.

## Reports

The existing `junit` and `lcov` adapters accept pytest JUnit XML and coverage.py LCOV.
A run manifest binds a report to its source snapshot.
Pytest dotted class names map to a unique known Python test file.
LCOV source paths map to repository files.
Failure exits on their own lines use LCOV line hits for `TEST-EXIT-NOT-RUN`.
An inline conditional exit stays UNKNOWN because its line can run without the exit.
Pytest JUnit class names also supply the suite identity for behavior checks.
Named regression checks still need bound run evidence.
Missing or self-attested reports do not prove an isolated regression run.
Refer to [verification](verify.md) for report binding and trust levels.

## Type checker and lint reports

Code-map reads reports from your own tool run or an authorized `code-map run`.
It never installs these tools or starts them during a scan.
Use these report kinds with `code-map manifest` and `reportInputs`:

| Kind | Tool output |
| --- | --- |
| `mypy-json` | `mypy --output json`, JSON lines from mypy 1.11 or later |
| `mypy-text` | `mypy --show-column-numbers --show-error-codes --no-pretty --no-error-summary` |
| `pyright-json` | `pyright --outputjson` |
| `ruff-json` | `ruff check --output-format json` |

Write a run manifest immediately after the tool run, before you change the source.
Record the actual exit status and the exact command words.
For example, after a mypy JSON run with exit status 1:

```sh
code-map manifest --artifact reports/mypy.jsonl --kind mypy-json --exit-status 1 --out reports/mypy.jsonl.manifest.json -- mypy --output json
```

Git must ignore the report folder. Add the artifact and manifest to `reportInputs`.
For an authorized worker run, use `--kind` and `--artifact` to keep its output file.
The authorization must name the exact command words of your project tool or wrapper.
The wrapper writes the report inside the worker workspace.
Code-map never creates an authorization for you.

Mypy and pyright errors feed `structure.types-compatible`.
An error in a changed Python file or a file that imports it fails the check.
A matching bound base diagnostic is an earlier error and still fails the check.
Python type evidence requires an unfiltered, complete head run.
A project with no TypeScript files and no bound Python type report gets NOT_APPLICABLE.
A bound type artifact that fails validation keeps the check UNKNOWN.
A mixed change needs evidence for both language families.
The feature request path keeps its existing consumer-contract check.

Ruff diagnostics are lint information only. No check or rating reads them.
Each tool retains its own label in the Markdown report.
Reports never prove which files the checker discovered.

Use the existing `inspect --summary --base <ref> --compiler-report <head report>` option.
Add `--base-compiler-report <base report>` to compare diagnostics of the same tool.
Each report needs the sidecar `<report>.manifest.json`.
Verification accepts multiple tool reports through `reportInputs`.
Lifecycle matching groups reports by tool and follows unique Git renames.
It normalizes quoted names, embedded source coordinates and mypy code suffixes.
Repeated identities, incompatible runs and incomplete evidence stay UNKNOWN.

Each artifact is limited to 50 MiB and 200,000 diagnostic entries.
Verification also limits the aggregate to 400,000 diagnostics.
Mypy notes and indented continuations count against the entry limit.
The adapters refuse the whole artifact for malformed entries, inconsistent summaries,
paths outside the repository or paths with control characters.
Mypy fatal errors, failed runs without errors and ruff syntax errors leave lifecycle UNKNOWN.
Ruff exit status 1 with lint diagnostics is a normal run.
Pyright exit status 1 with warnings and no errors is also a normal run, as with `--warnings`.
Pyright uses zero-based ranges. Code-map records one-based coordinates.
Mypy JSON columns are zero-based. Text and ruff coordinates are one-based.
An unknown mypy column is null.
Ruff fix details become a `fixable` flag. Code-map never applies a fix.

Format references: [mypy JSON source](https://github.com/python/mypy/blob/v1.11.0/mypy/error_formatter.py),
[mypy text source](https://github.com/python/mypy/blob/v1.11.0/mypy/errors.py),
[pyright CLI schema](https://github.com/microsoft/pyright/blob/main/docs/command-line.md#json-output)
and [ruff output settings](https://docs.astral.sh/ruff/settings/#output-format).

## Parser isolation and limits

The shipped parser runs with `-I -S -B -W ignore`, without a shell, in an empty temporary folder.
Code-map sends file paths and text through standard input as UTF-8 bytes.
The parser decodes these bytes as UTF-8 regardless of the locale.
The warning flag prevents warnings from filling standard error.
The parser reads syntax and never loads project modules.
`lib/python/facts.py` calls the files in `lib/python/extractors/` in a fixed order.
It loads them by absolute file path with `importlib.util.spec_from_file_location` and leaves `sys.path` unchanged.
Each batch has these limits:

| Limit | Value |
| --- | --- |
| Files | 64 |
| Input | 4 MiB |
| Output | 16 MiB |
| Elapsed time | 15 seconds |

When a child reaches its time or output limit, Code-map splits its batch in halves.
It retries both halves with the same child limits.
It repeats this step until the batch succeeds or contains one file.
Only a singleton that still fails counts as skipped for this limit failure.
The Python report records additional child attempts in `retries`.
An oversized input file, another parser failure or invalid facts also produces a skipped-file gap.
A syntax error records its line and counts as malformed.
Syntax newer than the selected interpreter also counts as malformed.

## Evidence limits

Computed `importlib.import_module` and `__import__` calls remain unresolved.
Computed plugin registration and changes to `sys.path` remain unknown.
Python files do not receive TypeScript import-name or npm package checks.

## Mutation testing

`code-map mutate` and generated-test mutation in `verify` use Code-map Python mutants for `.py` source files.
The isolated parser uses the same interpreter, flags, empty temporary folder and byte, output and time limits as the facts parser.
It reads text through stdin and never imports a project module.
Edits use JavaScript UTF-16 offsets. The parser converts Python AST UTF-8 byte columns before it returns each edit.
Only edits that start on a changed line enter the sample. Python test files, including custom configured patterns, do not enter it.

| Source | Replacement |
| --- | --- |
| `<`, `<=`, `>`, `>=`, `==`, `!=` | `<=`, `<`, `>=`, `>`, `!=`, `==` |
| `is`, `is not`, `in`, `not in` | `is not`, `is`, `not in`, `in` |
| `and` | `or` |
| `True`, `False` | `False`, `True` |
| Numeric literal `+` | `-` |
| Unary `not` | Its operand |
| Returned expression with an explicit optional annotation | `None` |

Optional annotations are `Optional[T]`, `Union[T, None]` and `T | None`, including qualified names.
String annotations and untyped returns produce no return mutant.
Arithmetic requires two numeric literals. Dynamic operands produce no arithmetic mutant.
There is no condition replacement or `or` replacement, as in the TypeScript generator.
Python receives no equivalent-candidate classification.
Each mutant must pass an isolated `ast.parse` before the worker runs it.
A syntax error produces `CompileError` with no mutant command run.

Use an existing authorization for the exact command words:

```sh
code-map mutate --authorization <id> --base main --head HEAD --max 20 -- python -m pytest '{testFiles}' --junitxml=junit.xml
```

The Python test links select `{testFiles}`. Preview the expanded command with `--print-selection` before you authorize it.
The baseline and every mutant use the same command in private worker copies.
The checkout never receives a mutant.
An explicit `--junitxml=path` or `--junitxml path` supplies assertion evidence.
The path must be relative and safe. Code-map adds no command words.
A kill requires matching baseline cases and a failed case, with no errored case or worker failure.
Missing cases, import errors and collection errors remain `RuntimeError`.
Without JUnit, a nonzero Python command has unknown failure classification.
Sampling, cache binding, budgets and scores use the shared mutation pipeline.
JSON and Markdown name the generator. Mutation results change no rating or readiness.

### Import mutmut results

Use report kind `mutmut-text` for mutmut 3.3.1 `mutmut results --all true` output.
The published [results command](https://github.com/boxed/mutmut/blob/3.3.1/mutmut/__main__.py) prints one mangled function key and status per line.
Its [name format](https://github.com/boxed/mutmut/blob/3.3.1/mutmut/trampoline_templates.py) distinguishes functions and methods.
The adapter maps each key through the Python facts of the bound snapshot.
It records `locationKind: "function"`, with the function line range, because this output has no mutant line.
Changed-line filtering therefore selects a function range. It does not prove which line mutmut changed.
The mutator name is unavailable in this format and remains explicit in each record.

Ignore the report folder in Git before the run. Write the manifest immediately after the command:

```sh
mutmut results --all true > reports/mutmut.txt
code-map manifest --artifact reports/mutmut.txt --kind mutmut-text --exit-status 0 --out reports/mutmut.manifest.json -- mutmut results --all true
```

Add the artifact and manifest pair to `reportInputs`, as for `stryker-json`.
The command must succeed. The manifest must bind to the head and declare its discovery scope.
The adapter maps `killed`, `survived`, `timeout`, `no tests`, `skipped` and `segfault` to `Killed`, `Survived`, `Timeout`, `NoCoverage`, `Ignored` and `RuntimeError`.
Other statuses, including `suspicious`, `not checked` and interrupted checks, remain `UNKNOWN` and stay outside the score.
The adapter refuses the whole report on a malformed entry, duplicate mutant, ambiguous function or location outside the repository.
Limits are 50 MiB per report and 400,000 mutants across a verification request.
Mutmut 2 JUnit is unsupported. Its [exporter](https://github.com/boxed/mutmut/blob/2.4.4/mutmut/cache.py) omits status information for some outcomes, so a result with no failure does not identify a killed mutant reliably.
Code-map never installs or starts mutmut during a scan.
