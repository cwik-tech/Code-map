// Layer rules from the "layers" of .code-map.json: an ordered list from the top layer to the bottom layer, each with path globs.
// A file in a lower layer must not import a file in a higher layer, unless "allowed" or "layerExceptions" allows that pair of layers.
// A layer break is an architecture-rule violation named "layer:<lower> -> <higher>". Pure: no I/O. Imports are possible dependencies.
import { compileGlob } from './glob.mjs';

/** The model keeps at most this many paths of the files in no layer. It counts all of them. */
const outsideKept = 50;
const layerRuleName = (lower, higher) => `layer:${lower} -> ${higher}`;

/** The import lines from one file to one target, as in lib/rules.mjs. */
const linesOf = (file, target) => [...new Set((file.edges ?? []).filter((edge) => edge.target === target).map((edge) => edge.line).filter((line) => line !== null))].sort((a, b) => a - b);

/**
 * The layer rules of the mapped source files, or null without layers. `declared` names each pair of layers that the rules
 * forbid, `violations` holds each import from a lower layer to a higher one, and `model` counts the files of each layer
 * and the files in no layer. A file that matches the paths of two layers throws, because its layer is not clear.
 */
export function layerViolations(files, layers, exceptions = []) {
  if (!Array.isArray(layers) || layers.length === 0) return null;
  const allowed = new Set(exceptions.map(({ from, to }) => `${from}\n${to}`)), layerOf = new Map();
  const matchers = new Map(layers.map((layer) => [layer, layer.paths.map(compileGlob)]));
  for (const file of files) {
    const matched = layers.filter((layer) => matchers.get(layer).some((matches) => matches(file.path)));
    if (matched.length > 1) throw new Error(`The layers "${matched[0].name}" and "${matched[1].name}" in .code-map.json both match ${file.path}. Each file must match the paths of one layer at most.`);
    if (matched.length) layerOf.set(file.path, layers.indexOf(matched[0]));
  }
  const forbidden = (lower, higher) => higher < lower && !allowed.has(`${layers[lower].name}\n${layers[higher].name}`);
  const declared = layers.flatMap((lower, low) => layers.slice(0, low).flatMap((higher, high) => forbidden(low, high) ? [layerRuleName(lower.name, higher.name)] : []));
  const violations = [];
  for (const file of files) {
    const from = layerOf.get(file.path);
    if (from === undefined) continue;
    for (const target of file.imports) {
      const to = layerOf.get(target);
      if (to === undefined || !forbidden(from, to)) continue;
      const names = { from: layers[from].name, to: layers[to].name };
      violations.push({ rule: layerRuleName(names.from, names.to), from: file.path, to: target, lines: linesOf(file, target), layers: names });
    }
  }
  const outside = files.map((file) => file.path).filter((path) => !layerOf.has(path)).sort();
  return { declared, violations, model: { layers: layers.map((layer, index) => ({ name: layer.name, files: [...layerOf.values()].filter((value) => value === index).length })),
    exceptions: exceptions.map(({ from, to }) => ({ from, to })), rules: declared, outside: { count: outside.length, paths: outside.slice(0, outsideKept) } } };
}

/**
 * The architecture rules of an analysis with the layer rules added. The layer rules count as declared rules and their breaks as
 * violations, so every reader of the rules (findings, the viewer, verify) reads them. `layers` is the layer model, or null.
 */
export function withLayers(rules, files, layers, exceptions) {
  const result = layerViolations(files, layers, exceptions ?? []);
  if (!result) return { ...rules, layers: null };
  return { ...rules, declared: [...rules.declared, ...result.declared], violations: [...rules.violations, ...result.violations], layers: result.model };
}
