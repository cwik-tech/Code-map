# Design: Electron support

**Status:** approved on 2026-10-24. The user accepted the recommended (first) answer of each decision in section 5.

## 1. Why this document exists

On 2026-10-22 the user deferred Electron, Python and React Native. Code-map maps the TypeScript code of an Electron app like any other code, and since 2026-10-23 it maps an `electron/` folder by default. It does not check anything that is special to Electron. The user now asked to implement everything that Electron needs.

The plan (`code_map_verification_spec.md`) names these Electron surfaces:

- C26: "Electron IPC handlers/callers". Check that producers and consumers agree.
- C36: "Electron startup/memory". Compare a controlled baseline with noise ranges and thresholds.
- The stack table: "Main ↔ preload ↔ renderer IPC channel contracts; context isolation; sandbox, permission boundaries; packaging; OS-specific behavior".

## 2. Terms

| Term | Meaning |
| --- | --- |
| Main process | The Node.js process of the app. It creates windows and registers IPC handlers with `ipcMain` |
| Preload | A script that runs before a page loads. It exposes a small API to the page with `contextBridge.exposeInMainWorld` |
| Renderer | The web page code, often a React app |
| Channel | The string name of an IPC message, such as `"settings:get"` |
| Wrapper | A function that passes its own parameter as the channel to an IPC call, such as `handleIpc(channel, fn)` |
| Self-attested report | A report from a run that the person made, not from Code-map's restricted worker |

## 3. What a real app showed

A real Electron app (React renderer, Electron 33, Vitest) was examined read-only. It never calls `ipcMain.handle` with a literal channel. One wrapper registers all handlers, and three wrappers in the preload make all calls, for example `handleIpc("settings:get", …)` and `invoke("settings:get", …)`. It also keeps a typed channel list in one file. Its windows set `contextIsolation: true`, `nodeIntegration: false` and `sandbox: true`, and it has a permission request handler. It has 18 `process.platform` checks. A useful check must therefore follow channels through wrappers.

## 4. What Code-map will do

### 4.1 IPC contracts (C26)

1. Find the IPC calls in the main process, the preload and the renderer: `ipcMain.handle`, `handleOnce`, `on`, `once`, `ipcRenderer.invoke`, `send`, `sendSync`, `on`, `once`, `webContents.send`, `event.sender.send` and `event.reply`.
2. Resolve the channel of each call: a string literal, a `const` value, a member of a constant object or enum, or a template literal with a fixed start. Other channels are UNKNOWN and are counted.
3. Follow wrappers: a function whose parameter reaches the channel argument of an IPC call, directly or through other wrappers, up to three levels. Each call of a wrapper with a known channel counts as an IPC call of the same kind.
4. Match the two directions:
   - Page to main: each `invoke` needs a `handle`, and each `send` needs an `on`.
   - Main to page: each `webContents.send` needs an `ipcRenderer.on` in the preload or the renderer.
5. Give findings:

| Rule | Severity | Meaning |
| --- | --- | --- |
| `ELECTRON-IPC-NO-HANDLER` | high | A page calls or sends a channel that no main-process code handles |
| `ELECTRON-IPC-KIND-MISMATCH` | high | An `invoke` targets a channel that has only an `on` listener, or a `send` targets a channel that has only a `handle` |
| `ELECTRON-IPC-NO-LISTENER` | medium | The main process sends a channel to the page, but no page code listens |
| `ELECTRON-IPC-UNUSED-HANDLER` | low | A handler has no caller in the mapped code |

6. In `verify`, the findings get the labels NEW, EXISTING and RESOLVED, as all findings do. Thus a change that renames a channel on one side only shows a NEW high finding.

### 4.2 Context isolation, sandbox and permissions

1. Read the `webPreferences` of each `new BrowserWindow(…)` and `new BrowserView(…)`. Missing values take the defaults of the Electron version in `package.json`: `contextIsolation` true since Electron 12, `nodeIntegration` false since 5, and `sandbox` true since 20.
2. Give the finding `ELECTRON-UNSAFE-WEB-PREFERENCES` (high) for `nodeIntegration: true`, `contextIsolation: false`, `sandbox: false`, `webSecurity: false` or `allowRunningInsecureContent: true`. A value that Code-map cannot read is UNKNOWN.
3. Give low-severity leads when no `setPermissionRequestHandler` exists, and when `shell.openExternal` gets a value that is not a literal.

### 4.3 Packaging and entry points

Resolve the `main` field of `package.json` and each `webPreferences.preload` path to their source files, through the `outDir` and `rootDir` of the TypeScript settings. These files become entry points. Thus the main process and the preload are never orphan leads, and the IPC check knows which file is the preload. An entry that Code-map cannot resolve is reported as a gap.

### 4.4 OS-specific behavior

List the `process.platform` and `os.platform()` branches of each file, with the platforms that they name. `verify` reports the platforms whose code a change touches, as information.

### 4.5 Startup time and memory (C36)

1. Code-map ships a small probe module. The person starts the app with it, for example `electron --require <probe> .`. The probe records the time to the `ready` event, to the first window's `ready-to-show` and to its `did-finish-load`, and the memory of each process from `app.getAppMetrics()`. It writes one JSON report and quits the app after a set time.
2. A new report kind `electron-startup` is bound with `code-map manifest`. `verify` compares the base and head reports with the same statistics as the controlled timings of C36: median, noise range and minimum change.
3. The report is self-attested. Refer to decision 1.

## 5. Decisions for the user

The first answer is the recommendation.

1. **Where does the startup measurement run?**
   - Recommended: in the person's own run, with the probe, as a self-attested report. The restricted worker cannot start a window on macOS, because its sandbox blocks the window server.
   - Alternative: a wider worker sandbox that allows the window server for Electron runs only. This weakens the isolation of those runs.
2. **Do the IPC and security findings change a rule set?**
   - Recommended: no. They are findings with NEW and EXISTING labels. `static-baseline-v0` and `evidence-v1` stay as accepted.
   - Alternative: add a check to `evidence-v1`, for example "no new high Electron finding".
3. **What does an unsafe `webPreferences` value give?**
   - Recommended: a high finding for each unsafe value, with Electron's version defaults for missing values.
   - Alternative: information only.
4. **What does OS-specific code give?**
   - Recommended: information only: an inventory and the platforms that a change touches.
   - Alternative: also a finding when tests never set the platform that a changed branch needs.

## 6. How it is built and checked

Three Codex sessions build it in parallel, each in its own worktree:

1. IPC contracts and wrappers (4.1).
2. Security, entry points and OS inventory (4.2 to 4.4).
3. The startup probe and the report comparison (4.5).

Each new behavior gets a test that fails without it. The trace (`calibration/trace.json`) moves the two Electron parts of C26 and C36 from "out of scope" to tests. The integrator runs the result read-only on the real Electron app of section 3. A new guide, `docs/electron.md`, describes the commands and the limits.

## 7. Limits

- Channels that Code-map cannot resolve stay UNKNOWN. Code-map never guesses a channel.
- A channel that only code outside the mapped roots uses can look unused.
- The startup report is as honest as the run that produced it. A signature can prove only who made it.
- Packaging checks cover the entry points only, not the file lists of `electron-builder`.
