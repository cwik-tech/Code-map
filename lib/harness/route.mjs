// OpenAPI example requests and bounded JSON response checks. This module executes no project code.
import { schemaProblems } from './schema.mjs';
const record = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
export const httpMethods = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'TRACE'];
const example = (x) => Object.hasOwn(x, 'example') ? x.example : record(x.examples) ? Object.values(x.examples).find((y) => record(y) && Object.hasOwn(y, 'value'))?.value : undefined;
/** Build one request per exported method. Unsupported or incomplete operations stay UNKNOWN. */
export function routeCases(document, path, methods) {
  const item = record(document?.paths) && Object.hasOwn(document.paths, path) ? document.paths[path] : null;
  return methods.map((method) => {
    const operation = record(item) && Object.hasOwn(item, method.toLowerCase()) ? item[method.toLowerCase()] : null;
    const result = { method, state: 'KNOWN', url: null, params: {}, headers: {}, responses: {}, body: undefined };
    const unknown = (reason) => ({ ...result, state: 'UNKNOWN', reason });
    if (!record(document) || typeof document.openapi !== 'string' || !record(operation) || !record(operation.responses)) return unknown('undocumented-or-unsupported-operation');
    if (item.$ref || operation.$ref) return unknown('unsupported-reference');
    result.responses = operation.responses;
    let url, prefix = '';
    const server = operation.servers?.[0] ?? item.servers?.[0] ?? document.servers?.[0];
    try {
      if (server !== undefined) {
        if (!record(server) || typeof server.url !== 'string' || server.url.includes('{')) return unknown('unsupported-server');
        const base = new URL(server.url, 'http://code-map.invalid');
        if (!['http:', 'https:'].includes(base.protocol) || base.search || base.hash) return unknown('unsupported-server');
        prefix = base.pathname.replace(/\/$/, '');
      }
      url = new URL(prefix + path, 'http://code-map.invalid');
    } catch { return unknown('invalid-path'); }
    if (!path.startsWith('/') || path.startsWith('//')) return unknown('invalid-path');
    const inherited = Array.isArray(item.parameters) ? item.parameters : [], parameters = Array.isArray(operation.parameters) ? operation.parameters : [];
    const merged = new Map([...inherited, ...parameters].map((x) => [`${x?.in}:${x?.name}`, x]));
    for (const parameter of merged.values()) {
      if (!record(parameter) || parameter.$ref || typeof parameter.name !== 'string') return unknown('unsupported-parameter');
      const value = example(parameter);
      if (value === undefined) { if (parameter.required || parameter.in === 'path') return unknown('missing-parameter-example'); continue; }
      if (parameter.schema !== undefined) {
        const problems = schemaProblems(parameter.schema, value);
        if (problems.length) return unknown(`parameter-example:${parameter.name}:${problems.join(',')}`);
      } else if (parameter.content !== undefined) return unknown('unsupported-parameter-content');
      if (parameter.style !== undefined || parameter.explode !== undefined) return unknown('unsupported-parameter-serialization');
      if (!['string', 'number', 'boolean'].includes(typeof value)) return unknown('unsupported-parameter-example');
      if (parameter.in === 'path') result.params[parameter.name] = String(value);
      else if (parameter.in === 'query') url.searchParams.set(parameter.name, String(value));
      else if (parameter.in === 'header') result.headers[parameter.name] = String(value);
      else return unknown('unsupported-parameter-location');
    }
    let missing = false;
    url.pathname = prefix + path.replace(/\{([^{}]+)\}/g, (token, name) => {
      if (!Object.hasOwn(result.params, name)) { missing = true; return token; }
      return encodeURIComponent(result.params[name]);
    });
    if (missing) return unknown('missing-path-example');
    if (operation.requestBody !== undefined) {
      const body = operation.requestBody, media = body?.content?.['application/json'];
      if (!record(body) || body.$ref || !record(media)) return unknown('unsupported-request-body');
      const value = example(media);
      if (value === undefined && body.required) return unknown('missing-body-example');
      if (value !== undefined && media.schema !== undefined) {
        const problems = schemaProblems(media.schema, value);
        if (problems.length) return unknown(`body-example:${problems.join(',')}`);
      }
      if (value !== undefined) { result.body = JSON.stringify(value); result.headers['content-type'] = 'application/json'; }
    }
    result.url = url.href;
    return result;
  });
}
/** Compare status and the supported JSON contract rules. */
export function responseProblems(operation, status, body) {
  const responses = operation.responses, entry = responses[String(status)] ?? responses[`${Math.floor(status / 100)}XX`] ?? responses.default;
  if (!record(entry)) return ['undocumented-status'];
  if (entry.$ref) return ['UNKNOWN:unsupported-response-reference'];
  if (status === 204 || operation.method === 'HEAD') return [];
  const schema = entry.content?.['application/json']?.schema;
  return schemaProblems(schema, body);
}
