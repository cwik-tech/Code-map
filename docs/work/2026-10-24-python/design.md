# Design: Python support

**Status:** started on 2026-10-24 under the user's goal "start implementing the Python version of the app so that we can scan such code bases". The user was not available to approve the decisions in section 5. The integrator chose the safe option of each one. The user can change any of them.

## 1. Why this document exists

On 2026-10-22 the user deferred Python. Code-map reads only TypeScript, JavaScript and JSON. In a repository with Python, it counts the `.py` files as "files in languages that the analysis does not read". The user now wants Code-map to scan Python codebases.

The plan (`code_map_verification_spec.md`) names these Python surfaces:

- The stack table: "AST+import resolution; mypy/pyright/ruff; pytest collection and coverage; typing/protocols; entrypoints and plugin registration; dynamic imports explicitly marked unknown".
- C02: configured Python analyzers. C04: public annotations and stubs. C10: pytest collection. C15: mutmut. C17: Hypothesis. C22: Pydantic constraints. C26: Python settings. C36: Python throughput.

## 2. Terms

| Term | Meaning |
| --- | --- |
| `ast` | The parser module of the Python standard library. `ast.parse` builds a syntax tree. It never runs the code |
| Interpreter | The Python program that Code-map starts to parse files |
| Module | A `.py` file. Its dotted name, such as `app.services.users`, comes from its path below a source root |
| Package | A folder of modules, with or without `__init__.py` |
| Source root | A folder below which module names start, such as the repository root or `src/` |

## 3. How Code-map parses Python

Code-map has no Python parser, and its only dependency is TypeScript. The safest parser is Python's own `ast` module:

1. Code-map first checks `CODE_MAP_PYTHON`. This environment variable accepts only an absolute path and takes precedence over the repository setting. The `python.interpreter` setting accepts only `python3` or `python3.<minor>`, without a path. Code-map searches for a name only in absolute `PATH` entries, `/opt/homebrew/bin`, `/usr/local/bin`, `/usr/bin` and `/Library/Frameworks/Python.framework/Versions/*/bin`. It skips all relative `PATH` entries. Without an explicit selection, it selects the newest Python 3.8+ interpreter from these folders. Code-map resolves every candidate with `realpathSync`. It refuses real paths inside the scanned repository, including symlink targets and environment selections. Invalid values and selections without a usable interpreter produce an UNKNOWN Python gap with a reason. The interpreter record includes its path, version and source (`environment`, `setting` or `discovery`) in the analysis, summary and snapshot identity. The cache key includes the repository real path, setting, environment selection, `PATH`, folders and candidate real paths with file metadata.
2. Code-map starts the shipped parser with `-I -S -B -W ignore` in an empty temporary folder. These flags ignore Python environment variables and site packages, prevent bytecode files and suppress warnings. Code-map sends the file texts as UTF-8 bytes through standard input. The parser decodes these bytes as UTF-8 regardless of the locale. The parser never imports or runs a project file.
3. The script returns JSON facts for each file. A file that does not parse counts as malformed, with its error.
4. Without an interpreter, the Python stack is reported as a gap, and the rest of the analysis works as before.

## 4. What phase 1 builds

Phase 1 makes a Python codebase scannable with the same core results as a TypeScript one.

1. **Facts of each file:** imports (`import a.b`, `from .x import y`, relative levels, `__future__`), definitions (functions, async functions, classes, methods, with lines and decorators), `__all__`, top-level names, and complexity (cyclomatic, nesting) of each function.
2. **Source roots and module names:** the repository root, `src/`, and the package folders that `pyproject.toml` declares (setuptools, Poetry and Hatch forms). A setting `roots` still wins.
3. **Import resolution:** a relative or absolute import resolves to a module or package of the repository. An import that names a standard-library module (from `sys.stdlib_module_names` of the interpreter) is the standard library. Other imports are third-party packages. `importlib.import_module(...)` and `__import__(...)` with a computed name are dynamic and UNKNOWN.
4. **Integration:** Python modules become source files of the analysis, with imports, importers, impact, cycles, hotspots and the map page. The completeness table gets a `Python` stack with its counts.
5. **Findings:** `IMPORT-UNRESOLVED` for a relative import, or an absolute import whose first name is a package of the repository, that resolves to no module. `CYCLE-VALUE` and `CYCLE-ALL` come from the graph. Rules that depend on TypeScript facts do not apply to Python files.
6. **Tests:** pytest and unittest discovery from syntax: test files by the default pytest patterns (`test_*.py`, `*_test.py`) and the `testpaths` and `python_files` settings, test functions, test classes, `unittest.TestCase` methods, and the markers `skip`, `skipif`, `xfail` and `parametrize`. Tests link to the modules that they import, directly and transitively.
7. **Reports:** pytest JUnit XML and coverage.py LCOV already bind through the existing adapters. Phase 1 checks that their file paths map to Python modules.

## 5. Decisions

The first option is the one that phase 1 uses.

1. **Parser:** Python's `ast` in an isolated interpreter. Alternative: a parser written in JavaScript, which needs no interpreter but would be large and less exact.
2. **Third-party imports:** an import that is not local and not the standard library counts as third-party. A package check against `pyproject.toml` and `requirements*.txt` comes in phase 2. Alternative: flag undeclared packages now.
3. **Orphan files:** no `FILE-ORPHANED` lead for Python modules in phase 1. Python has many entry points (scripts, `__main__`, console scripts, plugin registration) that phase 1 does not read. Alternative: report orphans now, with many false leads.
4. **Rule sets:** no rule set changes. Python files feed the existing checks through the same facts (imports, tests, findings).

## 6. Later phases

- Phase 2: declared packages (`pyproject.toml`, `requirements*.txt`, Poetry lock), entry points and console scripts, failure-exit analysis of functions and `pytest.raises` evidence, `__all__` exports.
- Phase 3: reports of mypy, pyright and ruff (C02), annotations and stubs (C04), mutmut (C15), Hypothesis (C17), Pydantic constraints (C22), settings (C26) and throughput (C36).

## 7. How it is built and checked

A Codex session builds phase 1 in its own worktree, with a test that fails without each behavior. Heavy test runs go through `heavy-run`. The integrator then runs Code-map read-only on three Python repositories of the user: two small ones and one large open-source clone with about 2,300 Python files.

## 8. Limits

- Code-map needs a Python interpreter, version 3.8 or later, to read Python. It never installs one.
- Syntax that only a newer Python version supports than the interpreter counts as malformed.
- Static imports only. Plugin registration, `sys.path` changes and dynamic imports stay UNKNOWN.
