// Expand only simple, literal settings names. Unsupported sources retain UNKNOWN.
export function settingsReads(model, nestedModel, location = (field) => ({ line: field.line })) {
  const config = model.config, caseSensitive = config.case_sensitive === true;
  const read = (field, name, reason = null) => ({ name, ...location(field), via: 'pydantic.BaseSettings', form: reason ? 'computed' : 'field',
    caseSensitive, ...(reason ? { state: 'UNKNOWN', reason } : {}) });
  const visit = (fields, prefix, visiting) => fields.flatMap((field) => {
    const alias = field.validation_alias ?? field.alias;
    if (model.configUnknown.length || field.unknown.some((x) => x.startsWith('dynamic-')
      || x.startsWith('custom-metadata:') || x.startsWith('metadata:') || x === 'keyword:env' || x === 'keyword:None')) {
      return [read(field, null, 'dynamic-settings-config-or-alias')];
    }
    const name = alias !== null && !visiting.size ? alias : `${prefix}${alias ?? field.path}`;
    if (field.type !== 'unknown') return [read(field, name)];
    const nested = nestedModel(field), delimiter = config.env_nested_delimiter;
    if (!nested || !delimiter || typeof delimiter !== 'string' || visiting.has(nested) || visiting.size >= 10
      || nested.configUnknown.length || nested.fields.some((f) => f.type === 'unknown')) return [read(field, null, 'dynamic-or-nested-settings')];
    return [read(field, name), ...visit(nested.fields, `${name}${delimiter}`, new Set([...visiting, nested]))];
  });
  return visit(model.fields, config.env_prefix ?? '', new Set());
}
