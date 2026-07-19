/**
 * Export helpers — PDF/CSV read only metricsSnapshot (+ section prose).
 */

import type { RecapMetricsSnapshot } from "./types";

function csvEscape(v: unknown): string {
  const s = v == null ? "" : String(v);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function metricsSnapshotToCsv(snapshot: RecapMetricsSnapshot): string {
  const lines: string[] = [];
  lines.push(["metric", "value"].map(csvEscape).join(","));
  lines.push(["headline.registrants", snapshot.headline.registrants].map(csvEscape).join(","));
  lines.push(["headline.checkIns", snapshot.headline.checkIns].map(csvEscape).join(","));
  lines.push(["headline.checkInRate", snapshot.headline.checkInRate].map(csvEscape).join(","));
  lines.push(["headline.adoptionCount", snapshot.headline.adoptionCount].map(csvEscape).join(","));
  lines.push(["headline.adoptionRate", snapshot.headline.adoptionRate].map(csvEscape).join(","));
  lines.push(["engagement.qaThreads", snapshot.engagement.qaThreads].map(csvEscape).join(","));
  lines.push(["engagement.qaUpvotes", snapshot.engagement.qaUpvotes].map(csvEscape).join(","));
  lines.push(["engagement.pollVotes", snapshot.engagement.pollVotes].map(csvEscape).join(","));
  lines.push(["engagement.communityThreads", snapshot.engagement.communityThreads].map(csvEscape).join(","));
  lines.push(["engagement.communityReplies", snapshot.engagement.communityReplies].map(csvEscape).join(","));
  lines.push(["engagement.engagementPoints", snapshot.engagement.engagementPoints].map(csvEscape).join(","));

  lines.push("");
  lines.push(
    [
      "sessionId",
      "title",
      "joinedTotal",
      "checkedInAttributedTotal",
      "noShowTotal",
      "likes",
      "qaThreads",
      "pollVotes",
      "feedbackCount",
      "avgFeedback",
      "joined.IN_PERSON",
      "joined.VIRTUAL",
      "joined.ASYNC",
      "checkedInAttributed.IN_PERSON",
      "checkedInAttributed.VIRTUAL",
      "checkedInAttributed.ASYNC",
    ]
      .map(csvEscape)
      .join(","),
  );
  for (const s of snapshot.sessions) {
    lines.push(
      [
        s.sessionId,
        s.title,
        s.joinedTotal,
        s.checkedInAttributedTotal,
        s.noShowTotal,
        s.likes,
        s.qaThreads,
        s.pollVotes,
        s.feedbackCount,
        s.avgFeedback,
        s.joinedByMode.IN_PERSON ?? 0,
        s.joinedByMode.VIRTUAL ?? 0,
        s.joinedByMode.ASYNC ?? 0,
        s.checkedInAttributedByMode.IN_PERSON ?? 0,
        s.checkedInAttributedByMode.VIRTUAL ?? 0,
        s.checkedInAttributedByMode.ASYNC ?? 0,
      ]
        .map(csvEscape)
        .join(","),
    );
  }
  return lines.join("\n");
}

/** Minimal text “PDF bundle” stand-in — real PDF can wrap this later; numbers from snapshot only. */
export function metricsSnapshotToPlainReport(
  snapshot: RecapMetricsSnapshot,
  reportMarkdown: string,
): string {
  return [
    reportMarkdown,
    "",
    "---",
    "Verified metrics (metricsSnapshot)",
    JSON.stringify(snapshot.headline),
    JSON.stringify(snapshot.engagement),
  ].join("\n");
}
