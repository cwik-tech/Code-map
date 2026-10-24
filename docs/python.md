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
Phase 1 does not check installed or declared Python dependencies.

The shared graph provides importers, impact, cycles, hotspots and test links.
Python files contribute to the summary and the offline map.
A `Python` completeness row counts discovered, supported, parsed, skipped and malformed files.
It also counts unresolved dynamic imports.

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
A plain project helper call does not count as an assertion.
Each case has a suite, name, line and static status.
`skip` produces `skipped`, and `skipif` produces `conditional`.
`xfail` produces `expected-failure`.
Literal `parametrize` rows provide a row count in `each`.
The inventory counts each parameterized function once.
Computed parameter values have an unknown row count.

Test files link to source modules through direct and transitive imports.
A link does not prove execution or an assertion about the module.
Phase 1 does not collect tests through pytest plugins or custom hooks.

## Reports

The existing `junit` and `lcov` adapters accept pytest JUnit XML and coverage.py LCOV.
A run manifest binds a report to its source snapshot.
Pytest dotted class names map to a unique known Python test file.
LCOV source paths map to repository files.
Refer to [verification](verify.md) for report binding and trust levels.

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
Plugin registration and changes to `sys.path` remain unknown.
Python files do not receive TypeScript import-name or npm package checks.
Python files do not receive orphan findings in phase 1.
The parser records `__all__`, but phase 1 does not check public Python exports.
Python failure-exit analysis, typing checks and tool reports belong to later phases.
