// Reads one JSON Schema file: the type, enum, required list and properties of each object, also in nested objects and in
// array items. Other keywords are kept as a digest for each object, and the reader names them, so that a change there is
// UNKNOWN in a comparison. Annotations (title, description, $comment, examples) are not compared. It runs no code.
import { canonical } from '../inputs.mjs';
import { digest } from './shared.mjs';

/** Deeper objects are compared only as a digest, so a planted file cannot make the reader recurse without end. */
const maxDepth = 32;
const annotations = new Set(['title', 'description', '$comment', 'examples']);
const isRecord = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);
const strings = (value) => Array.isArray(value) && value.every((item) => typeof item === 'string');
const sortedUnique = (list) => [...new Set(list)].sort();
/** A JSON Pointer segment: "~" and "/" are escaped. */
const segment = (name) => name.replaceAll('~', '~0').replaceAll('/', '~1');

/**
 * The nodes of one schema, parent first. Each node has its JSON Pointer, its parent pointer and property name (null for
 * the root and for array items), `type` and `required` (sorted), `enum` (sorted canonical JSON values), and `other`: a digest
 * of the keywords that it does not read, named in `otherKeys`. A keyword with an unexpected value counts as not read.
 */
function nodesOf(root) {
  const nodes = [];
  const visit = (schema, pointer, parent, name, depth) => {
    const node = { pointer, parent, name, type: null, enum: null, required: null, other: null, otherKeys: [] };
    nodes.push(node);
    const opaque = depth > maxDepth ? '(nested too deep)' : typeof schema === 'boolean' ? '(boolean schema)' : !isRecord(schema) ? '(not a schema)' : null;
    if (opaque) { node.other = digest(canonical(schema)); node.otherKeys = [opaque]; return; }
    const rest = [], children = [];
    for (const [key, value] of Object.entries(schema)) {
      if (annotations.has(key)) continue;
      if (key === 'type' && (typeof value === 'string' || strings(value))) node.type = sortedUnique([value].flat());
      else if (key === 'enum' && Array.isArray(value)) node.enum = sortedUnique(value.map(canonical));
      else if (key === 'required' && strings(value)) node.required = sortedUnique(value);
      else if (key === 'properties' && isRecord(value)) for (const [child, sub] of Object.entries(value)) children.push([sub, `${pointer}/properties/${segment(child)}`, child]);
      else if (key === 'items' && (isRecord(value) || typeof value === 'boolean')) children.push([value, `${pointer}/items`, null]);
      else rest.push([key, value]);
    }
    rest.sort((a, b) => (a[0] < b[0] ? -1 : 1));
    if (rest.length) { node.other = digest(canonical(rest)); node.otherKeys = rest.map(([key]) => key); }
    for (const [sub, at, child] of children) visit(sub, at, pointer, child, depth + 1);
  };
  visit(root, '', null, null, 0);
  return nodes;
}

/** The schema of one file as one entity, and what the reader cannot read. Invalid JSON and a non-object file are unread. */
export function parseJsonSchema(text) {
  let value, nodes, sign;
  try { value = JSON.parse(text.replace(/^﻿/, '')); } catch { return { entities: [], unread: [{ line: null, reason: 'invalid-json', lost: true }] }; }
  if (!isRecord(value)) return { entities: [], unread: [{ line: null, reason: 'not-an-object', lost: true }] };
  // canonical() recurses, so a deep file can end the stack in it too.
  try { nodes = nodesOf(value); sign = digest(canonical(value)); } catch { return { entities: [], unread: [{ line: null, reason: 'too-deep', lost: true }] }; }
  const keys = sortedUnique(nodes.flatMap((node) => node.otherKeys));
  return { entities: [{ type: 'schema', line: 1, state: 'read', reason: null, digest: sign, nodes }],
    unread: keys.length ? [{ line: null, reason: 'keywords-not-compared', keys, lost: false }] : [] };
}
