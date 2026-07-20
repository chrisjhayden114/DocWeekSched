/** Pure readiness decision — used by GET /health/ready and unit tests. */
export function evaluateReadiness(input: {
  dbOk: boolean;
  jobPollerAgeMs: number | null;
  staleMs: number;
}): { ok: boolean; jobPollerOk: boolean } {
  const jobPollerOk = input.jobPollerAgeMs != null && input.jobPollerAgeMs < input.staleMs;
  return { ok: input.dbOk && jobPollerOk, jobPollerOk };
}
