// Classify Node TAP failures from runner diagnostics. Exit status alone proves no assertion failure.
import { basename } from 'node:path';

/** Accept one explicit Node TAP reporter on stdout. Other commands have unknown failure classification. */
export function supportsAssertionReport(command) {
  return ['node', 'node.exe'].includes(basename(command[0])) && command.includes('--test')
    && command.filter((word) => word.startsWith('--test-reporter')).length === 1
    && command.includes('--test-reporter=tap') && !command.some((word) => word.startsWith('--test-reporter-destination'));
}

/** Read the bounded Node TAP diagnostic subset. Unknown or mixed failures never count as a kill. */
export function assertionOutcome(text) {
  const unknown = (reason) => ({ status: 'RuntimeError', reason });
  if (!text.startsWith('TAP version 13\n')) return unknown('No supported Node TAP assertion report.');
  const lines = text.split('\n');
  let assertions = 0, failures = 0;
  const reasons = [];
  for (let index = 0; index < lines.length; index++) {
    const match = /^( *)not ok \d+ - (.*)$/.exec(lines[index]);
    if (!match) continue;
    failures++;
    const pad = match[1] + '  ', fields = new Map();
    if (lines[++index] !== pad + '---') return unknown('Incomplete runner failure diagnostics.');
    for (index++; index < lines.length && lines[index] !== pad + '...'; index++) {
      const field = /^([a-zA-Z]+): '([^']*)'$/.exec(lines[index].slice(pad.length));
      if (lines[index].startsWith(pad) && field) fields.set(field[1], field[2]);
    }
    if (index === lines.length) return unknown('Incomplete runner failure diagnostics.');
    if (/ # (?:SKIP|TODO)/.test(match[2])) return unknown('Expected or skipped runner failure has no assertion kill.');
    if (fields.get('failureType') === 'subtestsFailed') continue;
    if (fields.get('failureType') === 'testCodeFailure' && fields.get('code') === 'ERR_ASSERTION'
      && fields.get('type') === 'test' && fields.get('name') === 'AssertionError') assertions++;
    else reasons.push(`Runner failure: ${fields.get('failureType') ?? 'unknown'} (${fields.get('code') ?? 'unknown code'}).`);
  }
  const count = /^# fail (\d+)$/m.exec(text), tests = /^# tests (\d+)$/m.exec(text);
  if (!count || Number(count[1]) < 1 || !tests || Number(tests[1]) < 1 || !/^# cancelled 0$/m.test(text)
    || !/^# duration_ms [\d.]+\n$/.test(text.slice(text.lastIndexOf('# duration_ms ')))) return unknown('Incomplete runner summary.');
  if (reasons.length) return unknown(reasons.join(' '));
  if (!failures || !assertions) return unknown('No supported assertion failure. Collection or runner failure remains unknown.');
  return { status: 'Killed', reason: 'Node TAP records an assertion failure. No collection or runner failure was found.' };
}
