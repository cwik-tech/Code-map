// Opt-in Electron main-process preload. No Electron import or side effect without the report variable.
const { validateStartup } = require('./startup-schema.cjs');

function startProbe(app, clock, files, env) {
  const path = env.CODE_MAP_ELECTRON_REPORT;
  if (typeof path !== 'string' || !path.length) return false;
  if (path.length > 4096 || path.includes('\0')) throw new Error('Invalid Electron report path.');
  const seconds = env.CODE_MAP_ELECTRON_SECONDS === undefined ? 5 : Number(env.CODE_MAP_ELECTRON_SECONDS);
  if (!Number.isInteger(seconds) || seconds < 1 || seconds > 300) throw new Error('Electron seconds must be an integer from 1 to 300.');
  const previous = files.read(path);
  if (previous !== null && previous !== undefined) {
    const checked = validateStartup(previous);
    if (!checked.ok) throw new Error(`Cannot append Electron report: ${checked.error}`);
    if (previous.seconds !== seconds) throw new Error('Electron report seconds differ. Use a new report path.');
    if (previous.samples.length >= 100) throw new Error('Electron report already has 100 samples. Use a new report path.');
  }
  const sample = { readyMs: null, readyToShowMs: null, didFinishLoadMs: null, processes: [] };
  app.once('ready', () => { sample.readyMs = clock.now(); });
  app.once('browser-window-created', (_event, window) => {
    window.once('ready-to-show', () => { sample.readyToShowMs = clock.now(); });
    window.webContents.once('did-finish-load', () => { sample.didFinishLoadMs = clock.now(); });
  });
  clock.after(seconds * 1000, () => {
    try {
      const metrics = app.getAppMetrics();
      if (!Array.isArray(metrics) || metrics.length > 256) throw new Error('Invalid or excessive Electron process metrics.');
      sample.processes = metrics.map((metric) => ({ type: metric?.type, workingSetKB: metric?.memory?.workingSetSize }));
      const report = { reportType: 'code-map-electron-startup', schemaVersion: 1, seconds, samples: [...(previous?.samples ?? []), sample] };
      const checked = validateStartup(report);
      if (!checked.ok) throw new Error(checked.error);
      files.write(path, report);
    } finally { app.quit(); }
  });
  return true;
}


function probeFiles() {
  const fs = require('node:fs');
  return {
    read(path) {
      let descriptor;
      try { descriptor = fs.openSync(path, fs.constants.O_RDONLY | fs.constants.O_NONBLOCK); }
      catch (error) { if (error.code === 'ENOENT') return null; throw error; }
      try {
        const info = fs.fstatSync(descriptor);
        if (!info.isFile() || info.size > 4 * 1024 * 1024) throw new Error('Electron report must be a regular file of at most 4 MiB.');
        return JSON.parse(fs.readFileSync(descriptor, 'utf8'));
      } finally { fs.closeSync(descriptor); }
    },
    write(path, report) {
      const temporary = `${path}.${process.pid}.tmp`;
      const descriptor = fs.openSync(temporary, 'wx', 0o600);
      try {
        try { fs.writeFileSync(descriptor, JSON.stringify(report, null, 2) + '\n'); }
        finally { fs.closeSync(descriptor); }
        fs.renameSync(temporary, path);
      } finally { fs.rmSync(temporary, { force: true }); }
    },
  };
}
module.exports = { startProbe, probeFiles };

if (process.env.CODE_MAP_ELECTRON_REPORT && process.versions.electron && process.type === 'browser') {
  const { app } = require('electron');
  startProbe(app, { now: () => process.uptime() * 1000, after: (ms, fn) => setTimeout(fn, ms) }, probeFiles(), process.env);
}
