/**
 * OKB's own AI calls, one at a time in this process: each checks the day's
 * budget, calls the model and records what it spent before the next one checks.
 * Two clicks at once can then never both pass a budget that holds only one.
 */
let tail: Promise<unknown> = Promise.resolve();

export function oneAtATime<T>(work: () => Promise<T>): Promise<T> {
  const run = tail.then(work, work);
  tail = run.catch(() => undefined);
  return run;
}
