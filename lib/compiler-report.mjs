// Bounded Markdown for compiler lifecycle information. Diagnostic messages pass through the report's escaping boundary.
import { code, plain } from './verify-markdown.mjs';

/** Show counts and bounded NEW diagnostics. JSON retains every diagnostic. */
export function compilerLines(compiler, limit) {
  if (!compiler) return [];
  const tools = [...new Set(compiler.entries.map((entry) => entry.diagnostic.tool ?? 'tsc'))];
  const { counts } = compiler, fresh = compiler.entries.filter((entry) => entry.baseline === 'NEW');
  return ['## Compiler diagnostic lifecycle', '',
    `${counts.new} NEW, ${counts.existing} EXISTING, ${counts.resolved} RESOLVED, ${counts.unknown} UNKNOWN. This is information only. No check reads it. No check or rating reads ruff diagnostics.`,
    ...(tools.length ? [`Tools: ${tools.map((tool) => code(tool)).join(', ')}.`] : []),
    ...fresh.slice(0, limit).map(({ diagnostic }) => `- ${code(`${diagnostic.file ?? '(no file)'}:${diagnostic.line ?? 0}:${diagnostic.column ?? 0} ${diagnostic.tool && diagnostic.tool !== 'tsc' ? `${diagnostic.tool} ${diagnostic.code ?? 'syntax'}` : `TS${diagnostic.code}`}`)}: ${plain(diagnostic.message, 160)}`),
    ...(fresh.length > limit ? [`${fresh.length - limit} more NEW diagnostics are in verification-results.json.`] : []), ''];
}
