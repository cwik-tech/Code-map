// Reporting shares the normal finding lifecycle. No verification rule set consumes these leads as a gate.
export const ipcRuleIds = ['ELECTRON-IPC-NO-HANDLER', 'ELECTRON-IPC-KIND-MISMATCH', 'ELECTRON-IPC-NO-LISTENER', 'ELECTRON-IPC-UNUSED-HANDLER'];

export function electronIpcSummary(analysis, partCommand) {
  const ipc = analysis.frameworks?.electronIpc;
  if (!ipc) return {};
  return { electronIpc: { detected: true, channels: ipc.channels.length,
    handlers: ipc.calls.filter((x) => ['handle', 'on', 'listen'].includes(x.kind)).length,
    callers: ipc.calls.filter((x) => ['invoke', 'send', 'push'].includes(x.kind)).length,
    wrappers: ipc.wrappers.length, unknownChannels: ipc.unknownChannels.length,
    findings: Object.fromEntries(ipcRuleIds.map((id) => [id, ipc.leads.filter((x) => x.ruleId === id).length])),
    next: partCommand('electron.ipc'), informationOnly: true } };
}

export function electronIpcParts(analysis) {
  return { 'electron.ipc': analysis.frameworks?.electronIpc?.channels ?? [] };
}

export function electronIpcFindings(analysis, add) {
  for (const item of analysis.frameworks?.electronIpc?.leads ?? []) add(item.ruleId, [item.path, item.channel, item.kind, String(item.pattern)], {
    text: `${item.channel}: ${item.ruleId.slice('ELECTRON-IPC-'.length).toLowerCase().replaceAll('-', ' ')}. Static IPC contract lead. Code outside the mapped roots can explain it.`,
    location: { path: item.path, line: item.line, symbol: null }, paths: [item.path], facts: item,
    evidence: [{ path: item.path, line: item.line, text: `${item.kind} ${item.channel}` }],
  });
}
