// Evidence provenance and per-command minimums. Manifest claims never establish isolation.
export const trustTiers = Object.freeze(['static', 'self-attested', 'isolated', 'isolated-signed', 'trusted-signed']);
const rank = (tier) => trustTiers.indexOf(tier);
const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

/** Validates optional tool minimums at the configuration and private-record boundaries. */
export function trustPolicy(value = {}) {
  if (!isRecord(value) || Object.keys(value).length > 64) throw new Error('trust must be an object with at most 64 tool minimums.');
  for (const [tool, tier] of Object.entries(value)) {
    if (tool.length === 0 || tool.length > 4096 || /[\s\p{Cc}]/u.test(tool) || tool.startsWith('-') || !trustTiers.includes(tier)) {
      throw new Error(`trust: ${JSON.stringify(tool)} needs one command word and a known trust tier.`);
    }
  }
  return value;
}

/** Classifies verified provenance. A configured signer takes precedence over the local signer. */
export function evidenceTier({ imported = false, isolated = false, localSigned = false, trustedSigned = false } = {}) {
  return trustedSigned ? 'trusted-signed' : isolated ? localSigned ? 'isolated-signed' : 'isolated' : imported ? 'self-attested' : 'static';
}

/** The stricter repository or authorization minimum applies to the exact first command word. */
export function trustDecision(tier, command, repository = {}, authorization = {}) {
  const tool = command[0], minimum = [repository, authorization].reduce((current, policy) => {
    const next = Object.hasOwn(policy, tool) ? policy[tool] : 'static';
    return rank(next) > rank(current) ? next : current;
  }, 'static');
  const allowed = rank(tier) >= rank(minimum);
  return { tool, minimum, allowed, message: allowed ? null : `The tool ${tool} has tier ${tier}, below its minimum ${minimum}. The report does not count.` };
}
