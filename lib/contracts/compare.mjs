// Pure compatibility comparison for the supported GraphQL and Protocol Buffers subsets.
const byName = (list) => new Map(list.map((x) => [typeof x === 'string' ? x : x.name, x]));
/** Classify changes. UNKNOWN definitions cannot establish compatibility. */
export function compareContracts(base = [], head = []) {
  const changes = [], documents = new Map(head.map((x) => [x.path, x]));
  for (const before of base) {
    const after = documents.get(before.path), next = byName(after?.types ?? []);
    const add = (type, state, reason, member = null) => changes.push({ path: before.path, format: before.format, type, member, state, reason });
    if (before.gaps?.length || after?.gaps?.length || before.state === 'UNKNOWN' || after?.state === 'UNKNOWN') {
      add(null, 'UNKNOWN', 'unsupported-document'); continue;
    }
    for (const old of before.types) {
      const now = next.get(old.name);
      for (const number of now?.conflicts ?? []) add(old.name, 'BREAKING', 'reused-field-number', String(number));
      if (old.state !== 'KNOWN' || (now && now.state !== 'KNOWN')) { add(old.name, 'UNKNOWN', 'unsupported-type'); continue; }
      if (!now) { add(old.name, 'BREAKING', 'removed-type'); continue; }
      if (old.kind !== now.kind) { add(old.name, 'BREAKING', 'changed-kind'); continue; }
      const fields = byName(now.fields), oldFields = byName(old.fields);
      for (const field of old.fields) {
        const current = fields.get(field.name);
        if (!current) {
          const reserved = now.reservedNames?.includes(field.name) || now.reserved?.some(([a, b]) => field.number >= a && field.number <= b);
          add(old.name, reserved ? 'COMPATIBLE' : 'BREAKING', reserved ? 'reserved-field' : 'removed-field', field.name);
        } else {
          if (field.type !== current.type) add(old.name, 'BREAKING', 'changed-field-type', field.name);
          if (field.number !== current.number) add(old.name, 'BREAKING', 'changed-field-number', field.name);
          const args = byName(field.args ?? []);
          for (const arg of current.args ?? []) {
            const previous = args.get(arg.name);
            if (!previous || (!previous.required && arg.required)) add(old.name, arg.required ? 'BREAKING' : 'COMPATIBLE', arg.required ? 'required-argument' : 'optional-argument', `${field.name}(${arg.name})`);
            else if (arg.type !== previous.type) add(old.name, 'BREAKING', 'changed-argument-type', `${field.name}(${arg.name})`);
          }
          for (const arg of field.args ?? []) if (!(current.args ?? []).some((x) => x.name === arg.name)) add(old.name, 'BREAKING', 'removed-argument', `${field.name}(${arg.name})`);
        }
      }
      for (const field of now.fields) {
        if (!oldFields.has(field.name)) add(old.name, field.required ? 'BREAKING' : 'COMPATIBLE', field.required ? 'required-input-field' : 'added-field', field.name);
        if (before.format === 'proto' && (old.fields.some((x) => x.number === field.number && x.name !== field.name)
          || old.reserved?.some(([a, b]) => field.number >= a && field.number <= b))) add(old.name, 'BREAKING', 'reused-field-number', field.name);
      }
      const values = byName(now.values), methods = byName(now.methods ?? []);
      for (const [name, value] of byName(old.values)) {
        if (!values.has(name)) add(old.name, 'BREAKING', old.kind === 'union' ? 'removed-union-member' : 'removed-enum-value', name);
        else if (before.format === 'proto' && value.number !== values.get(name).number) add(old.name, 'BREAKING', 'changed-enum-number', name);
      }
      for (const method of old.methods ?? []) {
        const current = methods.get(method.name);
        if (!current) add(old.name, 'BREAKING', 'removed-method', method.name);
        else if (method.request !== current.request || method.response !== current.response) add(old.name, 'BREAKING', 'changed-method', method.name);
      }
    }
    for (const item of after?.types ?? []) if (!before.types.some((x) => x.name === item.name)) add(item.name, item.state === 'KNOWN' ? 'COMPATIBLE' : 'UNKNOWN', 'added-type');
  }
  for (const doc of head) if (!base.some((x) => x.path === doc.path)) changes.push({ path: doc.path, format: doc.format, type: null, member: null,
    state: doc.state === 'UNKNOWN' || doc.gaps?.length || doc.types.some((x) => x.state !== 'KNOWN') ? 'UNKNOWN' : 'COMPATIBLE', reason: 'added-document' });
  return changes;
}
