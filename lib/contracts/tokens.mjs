// Small token reader for bounded schema text. Unsupported syntax stays visible.
/** Tokenize strings, names, numbers and punctuation without losing unsupported characters. */
export function tokens(text) {
  return text.match(/"""[\s\S]*?"""|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|#[^\n]*|\/\/[^\n]*|\/\*[\s\S]*?\*\/|[A-Za-z_][\w.]*|-?\d+(?:\.\d+)?|[^\s,]/g)?.filter((x) => !/^(?:#|\/\/|\/\*)/.test(x)) ?? [];
}
/** A cursor with bounded block extraction. */
export function cursor(items) {
  let index = 0;
  const take = () => items[index++];
  const expect = (value) => { if (take() !== value) throw new Error('unsupported-syntax'); };
  const name = () => { const value = take(); if (!/^[A-Za-z_]\w*$/.test(value ?? '')) throw new Error('expected-name'); return value; };
  const block = () => {
    expect('{'); let depth = 1; const result = [];
    while (index < items.length && depth) {
      const value = take();
      if (value === '{') depth++;
      if (value === '}') depth--;
      if (depth) result.push(value);
    }
    if (depth) throw new Error('unclosed-block');
    return result;
  };
  return { take, expect, name, block, peek: () => items[index], more: () => index < items.length };
}
