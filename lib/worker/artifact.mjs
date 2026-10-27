// This fixed program copies an artifact through stdout inside the sandbox. No project module runs in the collector.
// A surviving sandbox process can change a path, but it cannot make this reader bypass the sandbox's read policy.
export const artifactScript = `
const fs = require('node:fs'), path = require('node:path');
const [tree, name, maximum] = process.argv.slice(1), max = Number(maximum);
let descriptor;
try {
  if (fs.lstatSync(tree).isSymbolicLink()) throw new Error('uses a symlink at the snapshot root. Code-map refuses it');
  const top = fs.realpathSync(tree), full = path.join(tree, name);
  if (top !== tree) throw new Error('leads outside the workspace');
  let current = top;
  for (const part of name.split('/')) {
    current = path.join(current, part);
    if (fs.lstatSync(current).isSymbolicLink()) throw new Error('uses a symlink. Code-map refuses it');
  }
  const real = fs.realpathSync(full), relative = path.relative(top, real);
  if (relative === '..' || relative.startsWith('../') || path.isAbsolute(relative)) throw new Error('leads outside the workspace');
  descriptor = fs.openSync(full, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
  const info = fs.fstatSync(descriptor);
  if (!info.isFile()) throw new Error('is not a regular file');
  if (info.size > max) throw new Error('is larger than ' + max + ' bytes');
  const bytes = Buffer.alloc(max + 1);
  let length = 0, count;
  while (length <= max && (count = fs.readSync(descriptor, bytes, length, bytes.length - length, null)) > 0) length += count;
  if (length > max) throw new Error('is larger than ' + max + ' bytes');
  if (fs.realpathSync(full) !== real) throw new Error('changed while Code-map read it');
  fs.writeFileSync(1, bytes.subarray(0, length));
} catch (error) {
  process.stderr.write(error.code === 'ENOENT' ? 'does not exist in the workspace after the run' : error.message);
  process.exitCode = 1;
} finally { if (descriptor !== undefined) fs.closeSync(descriptor); }
`;
