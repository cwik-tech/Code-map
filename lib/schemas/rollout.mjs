// Static rollout leads. Syntax witnesses do not prove deployment safety.
import ts from 'typescript';
import { compareSchemas } from './compare.mjs';
const key = (node) => node && (ts.isIdentifier(node) || ts.isStringLiteral(node)) ? node.text : null;
const lowerFirst = (name) => name[0].toLowerCase() + name.slice(1);
function witnesses(texts, entity, change, remapped = false) {
  const hits = [], field = change.member, dbTable = entity.map ?? entity.name;
  const member = (entity.fields ?? entity.columns ?? []).find((item) => item.name === field);
  const dbField = change.change === 'name-changed' ? change.from : member?.map ?? member?.column ?? field;
  for (const [path, text] of texts) {
    if (entity.namespace && !path.startsWith(`${entity.namespace}/`)) continue;
    const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
    const hit = (node, syntax) => hits.push({ path, line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1, syntax });
    const visit = (node) => {
      if (!remapped && change.change !== 'name-changed' && entity.kind === 'prisma' && ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
        const model = node.expression.expression;
        if (ts.isPropertyAccessExpression(model) && key(model.expression) === 'prisma' && model.name.text === lowerFirst(entity.name)) {
          if (field === null) hit(node, 'prisma');
          else if (change.change !== 'name-changed') {
            const options = node.arguments[0];
            if (options && ts.isObjectLiteralExpression(options)) for (const property of options.properties) {
              if (!ts.isPropertyAssignment(property) || !['select', 'where', 'data'].includes(key(property.name))) continue;
              const find = (child) => {
                if ((ts.isPropertyAssignment(child) || ts.isShorthandPropertyAssignment(child)) && key(child.name) === field) hit(child, 'prisma');
                ts.forEachChild(child, find);
              };
              find(property.initializer);
            }
          }
        }
      }
      if (!remapped && entity.kind === 'drizzle' && ts.isPropertyAccessExpression(node) && key(node.expression) === entity.variable
        && (field === null || (change.change !== 'name-changed' && node.name.text === field))) hit(node, 'drizzle');
      if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
        const sql = node.text.replace(/--[^\n]*|\/\*[\s\S]*?\*\//g, ' ').replace(/'([^']|'')*'/g, '');
        if (/^\s*(SELECT|INSERT|UPDATE|DELETE|ALTER|DROP|WITH)\b/i.test(sql)) {
          const names = sql.match(/[A-Za-z_]\w*/g) ?? [];
          if (names.some((name) => name.toLowerCase() === dbTable.toLowerCase())
            && (field === null || names.some((name) => name.toLowerCase() === dbField?.toLowerCase()))) hit(node, 'sql');
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return hits;
}
/** Returns removal and database-rename leads with base and head source witnesses. */
export function schemaRollout(base, head, baseTexts, headTexts, renames = [], complete = true) {
  const comparison = compareSchemas(base, head, renames, complete), leads = [];
  for (const change of comparison.changes) {
    if (!['prisma', 'drizzle', 'sql'].includes(change.kind) || !['entity-removed', 'field-removed', 'name-changed'].includes(change.change)) continue;
    const target = head?.entities.find((item) => item.kind === change.kind && item.name === change.entity && item.path === change.path);
    const entity = base?.entities.find((item) => item.kind === change.kind && item.name === change.entity
      && (change.side === 'base' ? item.path === change.path : item.namespace === target?.namespace));
    if (!entity || !['model', 'table'].includes(entity.type)) continue;
    const remapped = entity.kind === 'drizzle' && change.change === 'entity-removed'
      && head?.entities.some((item) => item.kind === 'drizzle' && item.namespace === entity.namespace && item.variable === entity.variable && item.name !== entity.name);
    const baseUses = witnesses(baseTexts, entity, change), headUses = witnesses(headTexts, entity, change, remapped);
    const kind = headUses.length ? 'contract-before-expand' : baseUses.length ? 'one-step-contract' : 'UNKNOWN';
    leads.push({ change, kind, baseUses, headUses, note: kind === 'contract-before-expand' ? 'Head code still uses the old name.'
      : kind === 'one-step-contract' ? 'A deployment with old code running can fail. Expand before contract in separate deployments.'
        : 'No supported consumer was observed. Deployment safety is unknown.' });
  }
  return { leads, informationOnly: true, note: 'Static syntax leads do not establish deployment order or complete consumer coverage.' };
}
