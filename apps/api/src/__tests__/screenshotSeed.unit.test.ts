/**
 * SHOT-CI — the screenshot fixture, checked without a database.
 *
 * The seed writer only ever runs inside the screenshots workflow, so nothing
 * here would notice a thin fixture until an image landed on the marketing site
 * showing an empty channel or a column of identical statuses. These assertions
 * are the part that can be verified locally: coverage, mixed states, honest
 * timing, and fictional names.
 */

import { describe, expect, it } from "vitest";
import { FEATURE_REGISTRY, resolveFeatureEnabled, type FeatureKey } from "@event-app/shared";
import {
  buildScreenshotSeedSpec,
  floorPlanDataUrl,
  momentDataUrl,
  SCREENSHOT_ATTENDEE_KEY,
  SCREENSHOT_ORGANIZER_KEY,
  SCREENSHOT_SEED_PASSWORD,
  screenshotFeatureOverrides,
  wordmarkDataUrl,
} from "../lib/screenshotSeed/fixture";

const spec = buildScreenshotSeedSpec();

function decodeDataUrl(url: string): string {
  const [meta, payload] = url.split(",");
  expect(meta).toBe("data:image/svg+xml;base64");
  return Buffer.from(payload!, "base64").toString("utf8");
}

describe("screenshot seed — feature coverage", () => {
  it("turns on every shipped feature except pick-one breakouts", () => {
    const overrides = screenshotFeatureOverrides();
    for (const def of FEATURE_REGISTRY) {
      if (def.retired || def.key === "breakout_style" || def.key === "public_leaderboard") continue;
      expect(overrides[def.key], `${def.key} must be on for its shot to exist`).toBe(true);
    }
  });

  it("leaves breakouts off the main event so the agenda card wall survives", () => {
    const overrides = screenshotFeatureOverrides();
    expect(overrides.breakout_style).toBeUndefined();
    expect(resolveFeatureEnabled("breakout_style", overrides)).toBe(false);
    // The dedicated PD-day event is where it is on instead.
    expect(spec.breakoutEvent.sessions.length).toBeGreaterThan(2);
  });

  it("does not enable the retired or unbuilt keys", () => {
    const overrides = screenshotFeatureOverrides();
    expect(overrides.messaging_event_chat).toBeUndefined();
    expect(overrides.public_leaderboard).toBeUndefined();
  });

  it("keeps every dependent channel resolvable once overrides are applied", () => {
    const overrides = screenshotFeatureOverrides();
    for (const def of FEATURE_REGISTRY) {
      if (def.retired || def.plannedPhase || def.key === "breakout_style") continue;
      expect(resolveFeatureEnabled(def.key as FeatureKey, overrides), def.key).toBe(true);
    }
  });
});

describe("screenshot seed — sessions", () => {
  const ends = (s: { startsInMinutes: number; durationMinutes: number }) =>
    s.startsInMinutes + s.durationMinutes;

  it("has finished, in-progress, and upcoming sessions whatever hour CI runs", () => {
    expect(spec.sessions.some((s) => ends(s) < 0), "a finished session is required for feedback").toBe(true);
    expect(spec.sessions.some((s) => s.startsInMinutes <= 0 && ends(s) > 0), "one in progress").toBe(true);
    expect(spec.sessions.some((s) => s.startsInMinutes > 0), "upcoming sessions").toBe(true);
  });

  it("spans two days", () => {
    const dayOf = (minutes: number) => Math.floor((minutes - 9 * 60) / (24 * 60));
    const days = new Set(spec.sessions.map((s) => dayOf(s.startsInMinutes)));
    expect(days.size).toBeGreaterThanOrEqual(2);
  });

  it("puts parallel sessions in different rooms so the by-room view has content", () => {
    const bySlot = new Map<number, string[]>();
    for (const s of spec.sessions) {
      const list = bySlot.get(s.startsInMinutes) ?? [];
      if (s.roomKey) list.push(s.roomKey);
      bySlot.set(s.startsInMinutes, list);
    }
    const parallel = [...bySlot.values()].filter((rooms) => rooms.length > 1);
    expect(parallel.length).toBeGreaterThan(0);
    for (const rooms of parallel) {
      expect(new Set(rooms).size, "parallel sessions cannot share a room").toBe(rooms.length);
    }
  });

  it("resolves every track, room, and speaker reference", () => {
    const trackKeys = new Set(spec.tracks.map((t) => t.key));
    const roomKeys = new Set(spec.rooms.map((r) => r.key));
    const speakerKeys = new Set(spec.speakers.map((s) => s.key));
    for (const s of [...spec.sessions, ...spec.breakoutEvent.sessions]) {
      expect(trackKeys, `${s.key} track`).toContain(s.trackKey);
      if (s.roomKey) expect(roomKeys, `${s.key} room`).toContain(s.roomKey);
      for (const k of s.speakerKeys) expect(speakerKeys, `${s.key} speaker`).toContain(k);
    }
  });

  it("caps exactly one session so Full — waitlist has somewhere to appear", () => {
    const capped = spec.sessions.filter((s) => s.inPersonCapacity != null);
    expect(capped).toHaveLength(1);
    expect(capped[0]!.inPersonCapacity).toBeLessThan(4);
  });

  it("offers a real choice per block on the breakouts event", () => {
    const bySlot = new Map<number, number>();
    for (const s of spec.breakoutEvent.sessions) {
      bySlot.set(s.startsInMinutes, (bySlot.get(s.startsInMinutes) ?? 0) + 1);
    }
    expect(bySlot.size).toBeGreaterThanOrEqual(2);
    for (const [slot, count] of bySlot) {
      expect(count, `slot ${slot} needs more than one option to pick between`).toBeGreaterThan(1);
    }
  });
});

describe("screenshot seed — community", () => {
  it("posts in every channel", () => {
    const channels = new Set(spec.threads.map((t) => t.channel));
    expect([...channels].sort()).toEqual(["GENERAL", "ICEBREAKER", "LOCAL", "MEETUP", "MOMENTS"]);
  });

  it("gives each channel the field that makes it distinctive", () => {
    expect(spec.threads.some((t) => t.channel === "MOMENTS" && (t.imageUrls?.length ?? 0) > 0)).toBe(true);
    expect(spec.threads.some((t) => t.channel === "LOCAL" && t.mapsUrl)).toBe(true);
    expect(spec.threads.some((t) => t.channel === "MEETUP" && t.meetupMode === "IN_PERSON")).toBe(true);
    expect(
      spec.threads.some((t) => t.channel === "MEETUP" && t.meetupMode === "VIRTUAL" && t.meetupMeetingUrl),
    ).toBe(true);
    expect(spec.threads.some((t) => t.channel === "GENERAL" && t.audienceType === "SESSION")).toBe(true);
  });

  it("only targets audiences on the General board", () => {
    for (const t of spec.threads) {
      if (t.audienceType && t.audienceType !== "EVERYONE") {
        expect(t.channel, "only GENERAL supports targeting").toBe("GENERAL");
        expect(t.audienceSessionKey).toBeTruthy();
      }
    }
  });

  it("points every author, tag, and audience at a seeded person or session", () => {
    const userKeys = new Set(spec.users.map((u) => u.key));
    const sessionKeys = new Set(spec.sessions.map((s) => s.key));
    for (const t of spec.threads) {
      expect(userKeys, `${t.key} author`).toContain(t.authorKey);
      for (const k of t.taggedUserKeys ?? []) expect(userKeys, `${t.key} tag`).toContain(k);
      for (const r of t.replies ?? []) expect(userKeys, `${t.key} reply`).toContain(r.authorKey);
      if (t.audienceSessionKey) expect(sessionKeys).toContain(t.audienceSessionKey);
    }
  });

  it("has replies so the feed is a conversation, not a noticeboard", () => {
    expect(spec.threads.filter((t) => (t.replies?.length ?? 0) > 0).length).toBeGreaterThanOrEqual(4);
  });
});

describe("screenshot seed — mixed states", () => {
  it("shows every payment status, including a never-tracked row", () => {
    const statuses = spec.users.map((u) => u.paymentStatus);
    for (const status of ["UNPAID", "PO_ON_FILE", "PAID", "WAIVED", "REFUNDED"]) {
      expect(statuses, `Payment column needs a ${status} row`).toContain(status);
    }
    // null is not UNPAID — the column renders them differently on purpose.
    expect(statuses).toContain(null);
  });

  it("shows every readiness state", () => {
    const statuses = new Set(spec.readiness.assignments.map((a) => a.status));
    expect([...statuses].sort()).toEqual([
      "IN_PROGRESS",
      "NEEDS_REVIEW",
      "NOT_APPLICABLE",
      "NOT_STARTED",
      "READY",
      "SUBMITTED",
      "WAIVED",
    ]);
  });

  it("assigns readiness against seeded requirements and speakers only", () => {
    const requirementKeys = new Set(spec.readiness.requirements.map((r) => r.key));
    const speakerKeys = new Set(spec.speakers.map((s) => s.key));
    for (const a of spec.readiness.assignments) {
      expect(requirementKeys).toContain(a.requirementKey);
      expect(speakerKeys).toContain(a.speakerKey);
    }
    // One overdue requirement so the board shows a late row, which is derived
    // from dueAt rather than stored.
    expect(spec.readiness.requirements.some((r) => r.dueInDays < 0)).toBe(true);
  });

  it("shows every outreach pipeline status", () => {
    const statuses = new Set(spec.prospects.map((p) => p.status));
    expect([...statuses].sort()).toEqual([
      "CONFIRMED",
      "CONTACTED",
      "DECLINED",
      "IN_CONVERSATION",
      "TO_CONTACT",
    ]);
  });

  it("names the confirmed prospect after a real sponsor so the conversion is visible", () => {
    const confirmed = spec.prospects.filter((p) => p.status === "CONFIRMED");
    expect(confirmed.length).toBeGreaterThan(0);
    const sponsorNames = spec.sponsors.map((s) => s.name);
    for (const p of confirmed) expect(sponsorNames).toContain(p.orgName);
  });

  it("spreads sponsors over more than one tier", () => {
    expect(new Set(spec.sponsors.map((s) => s.tier)).size).toBeGreaterThan(1);
  });

  it("gives the poll an uneven result instead of a flat tie", () => {
    const counts = new Array(spec.poll.options.length).fill(0);
    for (const v of spec.poll.votes) {
      expect(v.optionIndex, "vote points at a real option").toBeLessThan(spec.poll.options.length);
      counts[v.optionIndex] += 1;
    }
    expect(new Set(counts).size, "a tie photographs as a bug").toBeGreaterThan(1);
    expect(spec.poll.options.length).toBeGreaterThanOrEqual(2);
    expect(spec.poll.options.length).toBeLessThanOrEqual(12);
  });

  it("leaves some Q&A answered and some open", () => {
    expect(spec.qa.some((q) => q.answered)).toBe(true);
    expect(spec.qa.some((q) => !q.answered)).toBe(true);
    expect(new Set(spec.qa.map((q) => q.upvoterKeys.length)).size).toBeGreaterThan(1);
  });

  it("has feedback on a session that has already finished", () => {
    const endedKeys = new Set(
      spec.sessions.filter((s) => s.startsInMinutes + s.durationMinutes < 0).map((s) => s.key),
    );
    expect(spec.feedback.length).toBeGreaterThan(0);
    for (const f of spec.feedback) {
      expect(endedKeys, `${f.sessionKey} must have ended before feedback exists`).toContain(f.sessionKey);
      expect(f.rating).toBeGreaterThanOrEqual(1);
      expect(f.rating).toBeLessThanOrEqual(5);
    }
    expect(new Set(spec.feedback.map((f) => f.rating)).size).toBeGreaterThan(1);
  });

  it("checks some people in and not others", () => {
    expect(spec.users.some((u) => u.checkedIn)).toBe(true);
    expect(spec.users.some((u) => !u.checkedIn)).toBe(true);
  });

  it("opts most people into the directory but not all", () => {
    expect(spec.users.filter((u) => u.directoryOptIn).length).toBeGreaterThanOrEqual(5);
    expect(spec.users.some((u) => !u.directoryOptIn)).toBe(true);
  });
});

describe("screenshot seed — sign-in and people", () => {
  it("defines the two accounts Playwright signs in as", () => {
    const organizer = spec.users.find((u) => u.key === SCREENSHOT_ORGANIZER_KEY);
    const attendee = spec.users.find((u) => u.key === SCREENSHOT_ATTENDEE_KEY);
    expect(organizer?.eventRole).toBe("ADMIN");
    // Attendee surfaces differ for organizers, so the attendee shots need a
    // plain ATTENDEE membership.
    expect(attendee?.eventRole).toBe("ATTENDEE");
  });

  it("uses a password the login form will accept", () => {
    expect(SCREENSHOT_SEED_PASSWORD.length).toBeGreaterThanOrEqual(8);
  });

  it("has unique keys and emails", () => {
    expect(new Set(spec.users.map((u) => u.key)).size).toBe(spec.users.length);
    expect(new Set(spec.users.map((u) => u.email)).size).toBe(spec.users.length);
    expect(new Set(spec.speakers.map((s) => s.key)).size).toBe(spec.speakers.length);
    expect(new Set(spec.sessions.map((s) => s.key)).size).toBe(spec.sessions.length);
  });

  it("gives the attendee enough engagement points for a visible gem", () => {
    const attendee = spec.users.find((u) => u.key === SCREENSHOT_ATTENDEE_KEY)!;
    expect(attendee.engagementPoints).toBeGreaterThan(0);
  });

  it("keeps every address on a reserved domain — no real people or organisations", () => {
    const emails = [
      ...spec.users.map((u) => u.email),
      spec.cfp.submission.submitterEmail,
      ...spec.prospects.map((p) => p.contactEmail),
    ];
    for (const email of emails) {
      expect(email, `${email} must end in the reserved .example TLD`).toMatch(/\.example$/);
    }
    for (const url of [
      spec.event.paymentUrl,
      ...spec.sponsors.map((s) => s.url),
      ...spec.prospects.map((p) => p.websiteUrl),
    ]) {
      expect(url, `${url} must point at a reserved .example host`).toMatch(/^https:\/\/[^/]+\.example(\/|$)/);
    }
  });

  it("names Northbridge, not a real host", () => {
    expect(spec.org.name).toContain("Northbridge");
    expect(spec.event.name).toContain("Northbridge");
  });
});

describe("screenshot seed — inline artwork", () => {
  it("builds a floor plan the Maps tab can render offline", () => {
    const svg = decodeDataUrl(floorPlanDataUrl());
    expect(svg).toContain("<svg");
    expect(svg).toContain("Northbridge Hall");
  });

  it("keeps every map pin inside the image and mostly linked to a room", () => {
    for (const pin of spec.map.pins) {
      expect(pin.x).toBeGreaterThan(0);
      expect(pin.x).toBeLessThan(100);
      expect(pin.y).toBeGreaterThan(0);
      expect(pin.y).toBeLessThan(100);
    }
    const roomKeys = new Set(spec.rooms.map((r) => r.key));
    const linked = spec.map.pins.filter((p) => p.roomKey);
    expect(linked.length).toBeGreaterThan(1);
    for (const pin of linked) expect(roomKeys).toContain(pin.roomKey);
  });

  it("escapes captions into the moment and wordmark placeholders", () => {
    expect(decodeDataUrl(momentDataUrl("Hall <script>"))).not.toContain("<script>");
    expect(decodeDataUrl(wordmarkDataUrl("Kestrel & Co", "#1f3f7a"))).toContain("Kestrel  Co");
  });
});

describe("screenshot seed — organizer content", () => {
  it("publishes a fee, a link, and PO instructions for the Payment column's card", () => {
    expect(spec.event.paymentPriceText).toBeTruthy();
    expect(spec.event.paymentUrl).toMatch(/^https:\/\//);
    expect(spec.event.paymentInstructions).toBeTruthy();
  });

  it("keeps the CFP open with a submission already under review", () => {
    expect(spec.cfp.opensInDays).toBeLessThan(0);
    expect(spec.cfp.closesInDays).toBeGreaterThan(0);
    expect(spec.cfp.customFields.length).toBeGreaterThan(1);
    expect(spec.cfp.submission.abstract.length).toBeGreaterThan(80);
  });

  it("caps the assistant starters at the three the console allows", () => {
    expect(spec.event.assistantStarters.length).toBeLessThanOrEqual(3);
    for (const s of spec.event.assistantStarters) expect(s.length).toBeLessThanOrEqual(80);
  });

  it("writes notifications the attendee inbox can group", () => {
    const kinds = new Set(spec.notifications.map((n) => n.kind));
    expect(kinds.size).toBeGreaterThanOrEqual(4);
    expect(kinds).toContain("DIGEST_ROLLUP");
    expect(kinds).toContain("ANNOUNCEMENT");
    for (const n of spec.notifications) expect(n.minutesAgo).toBeGreaterThan(0);
  });

  it("seeds a DM, a group, and a still-pending request", () => {
    expect(spec.directMessage.memberKeys).toHaveLength(2);
    expect(spec.groupChat.memberKeys.length).toBeGreaterThan(2);
    expect(spec.groupChat.name).toBeTruthy();
    // One message only: a second would mean the request gate was accepted.
    expect(spec.messageRequest.fromKey).not.toBe(spec.messageRequest.toKey);
    expect(spec.messageRequest.body.length).toBeLessThanOrEqual(1000);
  });

  it("suggests at most the five matches a batch keeps", () => {
    expect(spec.matchSuggestions.length).toBeGreaterThan(0);
    expect(spec.matchSuggestions.length).toBeLessThanOrEqual(5);
    for (const m of spec.matchSuggestions) {
      expect(m.forUserKey).not.toBe(m.suggestedUserKey);
      expect(m.whyLine).toBeTruthy();
      expect(m.draftIntro).toBeTruthy();
    }
  });
});
