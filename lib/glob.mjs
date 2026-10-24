// Path globs for the allowed paths of a verification request, the layers of .code-map.json and the CODEOWNERS patterns.
// Pure, and linear in the length of the path, so a pattern cannot make it slow.

/**
 * Whether a repository-relative path matches a pattern, case-sensitively and over the whole path. "**" as a whole segment
 * matches zero or more segments. "*" matches any characters except "/", and "?" matches one character except "/".
 * "**" inside a segment is the same as "*". All other characters match only themselves.
 */
export const matchesGlob = (path, pattern) => compileGlob(pattern)(path);

/** The matcher of one pattern, for many paths. A segment without "*" or "?" is compared as a string. */
export function compileGlob(pattern) {
  const character = (token, char) => token === '?' || token === char;
  const tokens = pattern.split('/').map((token) => token === '**' ? token : /[*?]/.test(token) ? { chars: [...token] } : { literal: token });
  const segment = (token, part) => token.chars ? wildcard([...part], token.chars, '*', character) : token.literal === part;
  return (path) => wildcard(path.split('/'), tokens, '**', segment);
}

/** Wildcard matching that goes back only to the last star. Each pass is linear, so a pattern cannot make it slow. */
function wildcard(items, tokens, star, matches) {
  let item = 0, token = 0, lastStar = -1, resume = 0;
  while (item < items.length) {
    if (tokens[token] === star) { lastStar = token++; resume = item; }
    else if (token < tokens.length && matches(tokens[token], items[item])) { item++; token++; }
    else if (lastStar >= 0) { token = lastStar + 1; item = ++resume; }
    else return false;
  }
  while (tokens[token] === star) token++;
  return token === tokens.length;
}
