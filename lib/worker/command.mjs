// Command-word validation shared by authorization and verification requests.
const maxWords = 256, maxWordLength = 4096;

/** Why a list of command words cannot be authorized or run, or null. Code-map never gives the words to a shell. */
export function commandProblem(words) {
  if (!Array.isArray(words) || words.length === 0) return 'Give the command words, for example: node --test.';
  if (words.length > maxWords) return `A command has at most ${maxWords} words.`;
  if (!words.every((word) => typeof word === 'string' && word.length <= maxWordLength && !word.includes('\0'))) return `Each command word must be text of at most ${maxWordLength} characters, without a NUL character.`;
  if (words[0].length === 0 || words[0].startsWith('-')) return 'The first command word must name a program, and it must not start with "-".';
  return null;
}
