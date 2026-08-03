/**
 * Agenda-ingest polling + live-status helpers (Chunk E15.1 / E15.2).
 *
 * Real extractions of a 7-page PDF have taken over two minutes, so the page
 * must be willing to watch a run far longer than the old ~60–80s loop, while
 * backing off so it is not hammering the API for minutes on end.
 *
 * The job reports no percent-complete, so the UI shows an honest elapsed
 * timer and the stage the run actually reports — never an invented progress
 * percentage.
 */

/** After this long, tell the user the run is taking longer than usual. */
export const INGEST_POLL_OVERTIME_MS = 5 * 60_000;

/**
 * Absolute foreground ceiling. Runs are kept visible and polled in the
 * background (slow interval) between OVERTIME and HARD_STOP; only past this
 * do we stop watching and point at Ingest history.
 */
export const INGEST_POLL_HARD_STOP_MS = 30 * 60_000;

/**
 * Poll interval for a given elapsed time: quick at first so short runs feel
 * instant, backing off as the run gets longer.
 */
export function ingestPollDelayMs(elapsedMs: number): number {
  if (elapsedMs < 10_000) return 400;
  if (elapsedMs < 60_000) return 1_000;
  if (elapsedMs < INGEST_POLL_OVERTIME_MS) return 2_000;
  return 5_000;
}

/** Whether a run status means the job is still going. */
export function isIngestRunActive(status: string): boolean {
  return status === "PENDING" || status === "EXTRACTING";
}

/** Plain-English label for the stage the run reports. */
export function ingestStageLabel(status: string | null | undefined): string {
  switch (status) {
    case "PENDING":
      return "Queued";
    case "EXTRACTING":
      return "Reading your program";
    default:
      return "Working";
  }
}

/** "1:12"-style elapsed label (h:mm:ss past an hour). Counts whole seconds. */
export function formatElapsed(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const seconds = totalSeconds % 60;
  const minutes = Math.floor(totalSeconds / 60) % 60;
  const hours = Math.floor(totalSeconds / 3600);
  const ss = String(seconds).padStart(2, "0");
  if (hours > 0) return `${hours}:${String(minutes).padStart(2, "0")}:${ss}`;
  return `${minutes}:${ss}`;
}
