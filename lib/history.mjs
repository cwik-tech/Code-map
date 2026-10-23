// Line counts of every source file at each commit of the mapped branch, oldest first.
import { git } from './git.mjs';

/** First-parent history keeps the branch's own story; merged side branches appear at their merge. */
export function readHistory(directory, sha, roots, keep, maxSnapshots) {
  const log = git(directory, ['log', '--first-parent', '--reverse', '--format=%H%x09%cI%x09%s', sha])
    .split('\n').filter(Boolean);
  return sample(log, maxSnapshots).map((line) => {
    const [commit, date, ...subject] = line.split('\t');
    return { sha: commit, date, subject: subject.join('\t'), sizes: sizesAt(directory, commit, roots, keep) };
  });
}

function sample(items, max) {
  if (items.length <= max) return [...items];
  const step = (items.length - 1) / (max - 1);
  return Array.from({ length: max }, (_, index) => items[Math.round(index * step)]);
}

function sizesAt(directory, commit, roots, keep) {
  const sizes = new Map();
  let output;
  try {
    const pathspec = roots.includes('.') ? [] : ['--', ...roots];
    output = git(directory, ['grep', '-z', '--count', '-I', '-e', '', commit, ...pathspec]);
  } catch {
    return sizes; // git grep exits 1 when the commit has no matching files yet.
  }
  // With -z each entry is "<commit>:<path>\0<count>\n", and the path is not quoted.
  const fields = output.split('\0'), prefix = `${commit}:`;
  for (let index = 0; index + 1 < fields.length; index++) {
    const entry = index === 0 ? fields[0] : fields[index].slice(fields[index].indexOf('\n') + 1);
    const path = entry.startsWith(prefix) ? entry.slice(prefix.length) : null;
    if (path !== null && keep(path)) sizes.set(path, Number.parseInt(fields[index + 1], 10));
  }
  return sizes;
}

/** When each file first appeared and when its size last changed. */
export function fileTimes(snapshots) {
  const times = new Map();
  let previous = new Map();
  for (const snapshot of snapshots) {
    for (const [path, size] of snapshot.sizes) {
      const known = times.get(path);
      if (known === undefined) times.set(path, { created: snapshot.date, changed: snapshot.date });
      else if (previous.get(path) !== size) known.changed = snapshot.date;
    }
    previous = snapshot.sizes;
  }
  return times;
}
