// Acme Robotics — fictitious dispatcher, used only by the test suite.
import { randomUUID } from 'node:crypto';

export type Job = { id: string; robot: string; key: string };

/** One job per robot; a retried request with the same key returns the same job. */
export function assignJob(jobs: Map<string, Job>, robot: string, key: string): Job {
  const existing = jobs.get(key);
  if (existing) return existing;

  const job = { id: randomUUID(), robot, key };
  jobs.set(key, job);
  return job;
}

export const MAX_RETRIES = 3;
