/**
 * Global teardown companion to the E22 skip-vs-fail rule: when DB suites were
 * skipped (DATABASE_URL unset), repeat the notice at the END of the run so a
 * reader scanning the last lines cannot mistake "unit tests passed" for
 * "the full suite passed". The flag is set by vitest.config.ts.
 */
export default function dbPreflightGlobal(): () => void {
  return () => {
    if (process.env.E22_DB_SUITES_SKIPPED === "1") {
      console.warn(
        "\n[db-preflight] NOTE: DATABASE_URL was not set — every *.db.test.ts suite was SKIPPED. " +
          "The pass count above covers unit tests only (RUNBOOK §9 to run DB suites).",
      );
    }
  };
}
