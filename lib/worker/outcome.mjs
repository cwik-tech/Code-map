// Pure failure decisions keep supervision errors and survivors in the durable run record.
const stopped = {
  wallClockSeconds: (n) => `The wall-clock budget of ${n} seconds stopped the run`,
  outputMegabytes: (n) => `The output budget of ${n} MB stopped the run`,
  memoryMegabytes: (n) => `The memory budget of ${n} MB (a sampled limit) stopped the run`,
  diskMegabytes: (n) => `The disk budget of ${n} MB (a sampled limit) stopped the run`,
  interrupted: () => 'Code-map got a signal to stop, so it stopped the run',
};

/** Problems block artifact collection and make the run fail, regardless of the command exit status. */
export function runProblems(result, budgets) {
  const problems = result.stoppedBy ? [`${stopped[result.stoppedBy](budgets[result.stoppedBy])}, so Code-map keeps no artifact.`] : [];
  if (result.error) problems.push(result.error.message);
  if (result.processes.remaining.length) problems.push(`Processes of the run remain: ${result.processes.remaining.join(', ')}. Code-map refuses artifact collection.`);
  return problems;
}
