// How the reports of a stored analysis show triage (C41): the findings that the triage file hides, the entry of each finding,
// the precision of each labeled rule, the sample pages, and the expired and unused entries. Without a triage file and without
// the options --include-hidden and --unlabeled, every report stays as it was. `code-map verify` does not use this module.
import { findingRules } from './findings.mjs';
import { applyTriage, readTriage, states, triageFile } from './triage.mjs';

/** The summary shows at most this many expired and unused entries. */
const shownEntries = 20;
/** `confirmed` and `dismissed` are the labels of precision. A suppression is not a label. */
const isLabel = (note) => note !== undefined && (note.entry.state === 'confirmed' || note.entry.state === 'dismissed');
const byFingerprint = (a, b) => (a.fingerprint < b.fingerprint ? -1 : a.fingerprint > b.fingerprint ? 1 : 0);

/** The checks of the triage options, after the other retrieval checks. `used(name)` is true when the option has a value. */
export function checkTriageOptions(options, used) {
  if (used('include-hidden') && !options.summary && options.analysis === undefined) throw new Error('--include-hidden needs --summary or --analysis <id>.');
  for (const [one, other] of [['finding', 'include-hidden'], ['full', 'include-hidden'], ['part', 'include-hidden'], ['unlabeled', 'include-hidden'], ['unlabeled', 'base-analysis']]) {
    if (used(one) && used(other)) throw new Error(`Use either --${one} or --${other}, not both.`);
  }
  if (used('include-hidden') && !options.summary && !used('findings') && ((options.file ?? []).length || used('change'))) throw new Error('--include-hidden needs --summary or --findings. A file report shows no triage.');
  if (used('unlabeled') && !used('findings')) throw new Error('--unlabeled needs --findings.');
  if (used('unlabeled') && !used('rule')) throw new Error('--unlabeled needs --rule <rule id>, because a sample is of one rule.');
}

/**
 * The triage for the reports of one stored analysis, or null without a triage file and without triage options. Code-map reads
 * the file in the working folder of the repository now, also for an analysis of an older commit.
 */
export function triageContext(stored, comparison, options, today) {
  const file = readTriage(stored.inputs.repository, today), includeHidden = !!options['include-hidden'], unlabeled = !!options.unlabeled;
  if (file === null && !includeHidden && !unlabeled) return null;
  return { file, today, includeHidden, unlabeled, ...(file ? applyTriage(file, stored.findings, today, comparison) : { notes: new Map(), expired: [], unused: [] }) };
}

/** The entry of a finding as a list item shows it: the state, the owner, the dates and, after a rename, the fingerprint of the entry. */
function compact({ entry, expired, matchedBy }) {
  return { state: entry.state, owner: entry.owner, date: entry.date, ...(entry.expires ? { expires: entry.expires } : {}), ...(expired ? { expired: true } : {}),
    ...(matchedBy === 'fingerprint' ? {} : { matchedBy, fingerprint: entry.fingerprint }) };
}

const plain = { shown: (list) => list, note: () => ({}), args: [], filter: {}, hidden: () => ({}), block: () => ({}), detail: () => ({}) };

/** The parts that a report adds for triage. Without triage, each part changes nothing. */
export function triageView(context) {
  const triage = context.triage ?? null;
  if (!triage) return plain;
  const { file, notes, includeHidden, unlabeled } = triage, header = file ? { path: triageFile, digest: file.digest, date: triage.today } : null;
  const count = (list, state) => list.filter((finding) => notes.get(finding.id)?.hidden && notes.get(finding.id).entry.state === state).length;
  const hidden = (list) => ({ dismissed: count(list, 'dismissed'), suppressed: count(list, 'suppressed') });
  return {
    /** The findings of a list: without the hidden ones, all of them with --include-hidden, or the unlabeled ones in fingerprint order. */
    shown: (list) => unlabeled ? list.filter((finding) => !isLabel(notes.get(finding.id))).sort(byFingerprint)
      : includeHidden ? list : list.filter((finding) => !notes.get(finding.id)?.hidden),
    note: (finding) => notes.has(finding.id) ? { triage: compact(notes.get(finding.id)) } : {},
    /** The options that printed commands keep. */
    args: [...(includeHidden ? ['--include-hidden'] : []), ...(unlabeled ? ['--unlabeled'] : [])],
    filter: { ...(includeHidden ? { includeHidden } : {}), ...(unlabeled ? { unlabeled } : {}) },
    hidden: (list) => header ? { hidden: hidden(list) } : {},
    block: (list) => header ? { triage: { ...header, hidden: hidden(list) } } : {},
    detail: (finding) => {
      if (!header) return {};
      const note = notes.get(finding.id);
      return { triage: { ...header, entry: note?.entry ?? null, ...(note ? { matchedBy: note.matchedBy, hidden: note.hidden, expired: note.expired } : {}) } };
    },
  };
}

/**
 * The triage part of a summary: the file and its digest, the entries by state, the expired and unused entries, and the
 * precision of each rule with a label. These parts describe the whole analysis, not the selection of the summary.
 */
export function triageSummary(stored, context) {
  const triage = context.triage ?? null;
  if (!triage?.file) return {};
  const { file, notes } = triage, list = (items) => ({ total: items.length, items: items.slice(0, shownEntries) });
  const sample = (ruleId) => context.command(['inspect', '--analysis', context.id, '--findings', '--rule', ruleId, '--unlabeled']);
  const precision = Object.keys(findingRules).map((ruleId) => {
    const findings = stored.findings.filter((finding) => finding.ruleId === ruleId);
    const labeled = (state) => findings.filter((finding) => isLabel(notes.get(finding.id)) && notes.get(finding.id).entry.state === state).length;
    const confirmed = labeled('confirmed'), dismissed = labeled('dismissed'), total = confirmed + dismissed;
    return { ruleId, confirmed, dismissed, share: total ? Math.round((confirmed / total) * 1000) / 1000 : null, unlabeled: findings.length - total, sample: sample(ruleId) };
  }).filter((row) => row.share !== null);
  return { triage: { path: triageFile, digest: file.digest, date: triage.today, includeHidden: triage.includeHidden,
    entries: { total: file.entries.length, ...Object.fromEntries(states.map((state) => [state, file.entries.filter((entry) => entry.state === state).length])) },
    expired: list(triage.expired), unused: list(triage.unused), precision,
    commands: { triage: context.command(['triage', '--analysis', context.id, '--finding', '<finding id>', '--state', '<state>', '--reason', '<text>', '--owner', '<name>']),
      sample: sample('<rule id>') } } };
}
