# Electron

## IPC contracts

Code-map maps inter-process communication (IPC) when a repository package lists `electron` in `dependencies` or `devDependencies`.
It reads syntax with the TypeScript compiler. It never starts Electron or runs project code.

Run `code-map inspect --summary --worktree`.
The `frameworks.electronIpc` block counts channels, handlers, callers, wrappers, UNKNOWN channels and findings by rule.
Follow its `next` command to list `electron.ipc` channels with their producers and consumers.
The list uses the standard `--offset` and `--limit` options.
The stored analysis keeps unresolved calls in `analysis.frameworks.electronIpc.unknownChannels`, with a file and line.
Projects without an Electron dependency have no IPC block and no IPC finding.

The scan recognizes named imports, namespace imports and destructured `require('electron')` calls, including local aliases.
It maps `ipcMain.handle`, `handleOnce`, `on`, `once` and `removeHandler`.
It maps `ipcRenderer.invoke`, `send`, `sendSync`, `on` and `once`.
It also maps `webContents.send`, `win.webContents.send`, `contents.send`, typed `WebContents` sends, `event.sender.send` and `event.reply`.
A removal is inventory only. It does not register a handler.

Channels resolve from string literals, `const` aliases, constant object members and string enum members.
A template with a fixed literal start is a prefix pattern.
A pattern matches literal channels with that start.
Other expressions stay UNKNOWN.
An UNKNOWN counterpart suppresses a missing or unused contract finding that it can match.
An UNKNOWN channel alone does not prove a kind mismatch.

A wrapper passes a parameter as an IPC channel.
The scan follows local functions and imported functions through up to three wrapper levels.
It records the known channel at the wrapper call site.
The wrapper definition does not count as an UNKNOWN call.
Relative imports resolve against mapped source files, including JavaScript imports of TypeScript source.
Calls beyond the wrapper limit do not resolve to known channels.

### Injected wrappers

A function call can pass a wrapper in an object literal, with a shorthand property
or `key: wrapper`. The scan follows that property into the called function.
It accepts `param.key(...)`, `const { key } = param`, `const { key: local } = param`
and destructured parameters. Each supplied wrapper contributes its own endpoint.
A property name alone never establishes a wrapper.
The scan examines at most 10,000 call sites over three passes.
Injected parameter boundaries count toward the same three-level wrapper limit.

| Rule | Severity | Meaning |
| --- | --- | --- |
| `ELECTRON-IPC-NO-HANDLER` | high | A page invokes or sends a channel without a main handler |
| `ELECTRON-IPC-KIND-MISMATCH` | high | An invoke matches only an event listener, or a send matches only an invoke handler |
| `ELECTRON-IPC-NO-LISTENER` | medium | The main process sends a channel without a page listener |
| `ELECTRON-IPC-UNUSED-HANDLER` | low | A main handler has no mapped caller |

`invoke` matches `handle` or `handleOnce`.
`send` and `sendSync` match `on` or `once`.
Main-to-page sends match `ipcRenderer.on` or `once`.
Findings use capability C26 and the normal NEW, EXISTING and RESOLVED lifecycle in comparisons and verification.
These results are static leads. They add no check to `static-baseline-v0` or `evidence-v1`.
Code outside the mapped roots can explain an unmatched endpoint.
## Security, entry points and platform code

Code-map checks Electron only when a repository `package.json` lists `electron`
in `dependencies` or `devDependencies`. It parses source with TypeScript. It runs
no app code and starts no Electron process.

Run `code-map inspect --worktree --summary`. The `frameworks.electron` block
reports windows, package version ranges, source entry points, unresolved entries,
and platform comparisons. Each summary inventory has a total and at most
20 items. Full analysis stores all facts at
`analysis.frameworks.electron`.

### Window security

Code-map reads object literals passed to `new BrowserWindow` and
`new BrowserView`. It follows local `const` objects and TypeScript assertions.
Computed objects, spreads and unreadable values stay `UNKNOWN`.

Missing settings use the lowest version allowed by the Electron dependency
range. Context isolation defaults to true from version 12. Node integration
defaults to false from version 5. The sandbox defaults to true from version 20.
Code-map reads numeric versions, caret ranges, tilde ranges, wildcards,
comparators, hyphen ranges and alternatives. Prereleases, tags, URLs and
unsupported ranges leave missing settings `UNKNOWN`.

| Rule | Severity | Static lead |
| --- | --- | --- |
| `ELECTRON-UNSAFE-WEB-PREFERENCES` | high | One lead for each unsafe setting: node integration enabled, context isolation disabled, sandbox disabled, web security disabled, or insecure content enabled |
| `ELECTRON-NO-PERMISSION-HANDLER` | low | Windows exist without a `setPermissionRequestHandler` call in the main file or its mapped imports |
| `ELECTRON-OPEN-EXTERNAL-UNCHECKED` | low | `shell.openExternal` receives an argument other than a string literal |

A permission call in renderer code does not cover the main process. If the main
entry is unresolved, the window files seed the main-process import search.
These checks read the named API syntax. Renamed imports, wrappers and runtime
mutation of option objects are outside these checks. A permission call proves
its presence only. It does not prove that the permission policy is safe.

`ELECTRON-OPEN-EXTERNAL-UNCHECKED` cannot see URL validation before the call.
A validated address still gives this low lead. Dismiss the lead with `code-map triage`.

### ES-module preload paths

Code-map resolves `fileURLToPath(new URL('./preload.js', import.meta.url))`.
Import `fileURLToPath` from `url` or `node:url`. Local aliases and namespace
imports such as `url.fileURLToPath` also work. The scan checks bound imports.
Shadowed imports, unrelated helpers and a shadowed `URL` constructor stay unresolved.
The literal relative path starts with `./` or `../`. The path starts from the
compiled module folder. Code-map then maps the output path to its source file
through the TypeScript output settings. The source file gets the `preload` role.
Dynamic paths and other URL bases stay unresolved and give an `electronEntries` gap.

### Packaging entries

Code-map resolves the root `package.json` `main` path and preload paths to mapped
source files. It reverses `outDir` and `rootDir` from the parsed TypeScript
settings, including files such as `tsconfig.electron.json`. It substitutes
JavaScript output extensions with source extensions.

A preload path is a string literal or `path.join(__dirname, '<literal>')`.
Named `join` and `resolve` imports from `path` and `node:path` also work,
including local aliases. Shadowed or unrelated functions stay unresolved.
A string literal is relative to the repository root. Path helper calls use
`__dirname` as the output folder of the file that creates the window.
For example, `dist-electron/electron/preload.cjs` maps to `electron/preload.cts`
when TypeScript emits the repository root into `dist-electron`.
Code-map records the `main` or `preload` role and excludes resolved files from orphan
findings. Dynamic, missing and ambiguous targets create the `electronEntries`
gap. Packaging file lists and executable bundles are outside this check.

### Platform information

Code-map lists string values compared with `process.platform` or `os.platform()`
in each source file. It accepts equality and inequality in either order.
The list includes platform names such as `darwin`, `win32`, `linux` and `freebsd`.

`code-map verify --request <file>` reports `electron.platformsTouched`. It takes
the union of platform names in changed files in the base and head analyses.
The Markdown report includes one sentence with this list. Refer to
[verification requests](verify.md) for the request format.

The findings and platform information change no check, rating or readiness rule
in `static-baseline-v0` or `evidence-v1`.
## Startup time and memory

Code-map ships an optional CommonJS probe in `lib/electron/probe.cjs`.
The probe records app readiness, the first window, and memory for each process type.
The report is self-attested. Code-map does not launch the app or confirm the honesty of the measurement.

1. Run `code-map electron-probe` to print the absolute probe path and a usage example.
2. Create a report folder inside the app repository.
3. Start the app with the printed probe path:

   ```sh
   mkdir -p reports
   probe="$(code-map electron-probe | head -n 1)"
   CODE_MAP_ELECTRON_REPORT=reports/startup.json electron --require "$probe" .
   ```

4. Repeat the launch sequentially to append samples to the same report.
5. Bind the report immediately after the last run:

   ```sh
   code-map manifest --artifact reports/startup.json --kind electron-startup \
     --exit-status 0 --out reports/startup.manifest.json -- electron --require "$probe" .
   ```

6. Add the artifact and manifest pair to `reportInputs` in the [verification request](verify.md).

Collect and bind the base report before the code change. Collect and bind a separate head report after the change.
Use the same command, tools, environment, collection interval, and sample count for both sides.
Keep report files outside analysis inputs, for example in a Git-ignored `reports/` folder.
Create the destination folder before launch. Use one writer for each report path.

`CODE_MAP_ELECTRON_REPORT` enables the probe and names the report path.
Without the variable, the probe does nothing and does not import Electron.
`CODE_MAP_ELECTRON_SECONDS` sets an integer collection delay from 1 to 300 seconds. The default is 5 seconds.
The delay starts when the probe loads. Milestone times use milliseconds from process start.
After the delay, the probe reads metrics, writes the report, and calls `app.quit()`.

The probe observes `app.ready`, the first window's `ready-to-show`, and its web contents' `did-finish-load`.
A missing event has a `null` measurement. A second window does not replace the first window.
The two window events have no required order.
Refer to the [Electron window events](https://www.electronjs.org/docs/latest/api/browser-window/).
Each process record stores its type and `workingSetKB` from `memory.workingSetSize`.
Electron reports this value in [kilobytes](https://www.electronjs.org/docs/latest/api/structures/memory-info).
The total sums these process values. Shared memory can appear in more than one process.

The strict report format has these fields:

```json
{
  "reportType": "code-map-electron-startup",
  "schemaVersion": 1,
  "seconds": 5,
  "samples": [{
    "readyMs": 100,
    "readyToShowMs": 200,
    "didFinishLoadMs": 180,
    "processes": [{ "type": "Browser", "workingSetKB": 50000 }]
  }]
}
```

A report holds 1 to 100 samples. Each sample holds 1 to 256 process records.
A process type has 1 to 128 characters. Memory values range from zero to 1 trillion KB.
Milestone values range from zero to 86,400,000 milliseconds, or `null`.
Code-map rejects unknown fields, nonfinite numbers, invalid versions, and imported reports over 4 MiB.
The probe refuses an invalid existing report, a changed collection interval, or a report with 100 samples.
The probe replaces the report through a temporary file after each successful measurement.
If temporary file creation fails, the probe preserves the existing report and temporary file.

`verify` binds each report to the base or head snapshot through its manifest.
A successful, unfiltered run is required. A changed artifact fails the digest check.
`verification-results.json` adds `electronStartup`. The Markdown report adds a short startup and memory section.
These observations never change ratings, checks, or readiness in either rule set.

Each metric reports the median, median absolute deviation, minimum, change, and noise range.
The noise range is three times the sum of the base and head median absolute deviations.
A change exceeds the thresholds only when it exceeds both the noise range and `timings.minimumChangePercent`.
The default minimum change is 10 percent. The same threshold applies to memory.
A missing milestone or zero base median gives UNKNOWN for that metric.
Missing reports or incompatible collection settings give UNKNOWN for the comparison.

These reports do not record machine identity or load averages. Keep the machine and load stable during collection.
Code-map cannot detect machine or load differences from these reports.
Electron is not a Code-map dependency. The probe requires Electron in the app that you measure.
