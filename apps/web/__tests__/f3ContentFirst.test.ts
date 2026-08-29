import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Chunk F3 — Community, session Q&A, and Messages are content-first.
 * The acceptance pinned here (structurally, the way patternKit.test.ts
 * pins the reduced-motion chain): none of the three surfaces greets the
 * user with a permanent input form — composing is the kit Composer
 * (collapsed until invoked), and channel-specific fields live INSIDE the
 * expanded composer.
 */

const dashboardSrc = readFileSync(join(__dirname, "..", "pages", "dashboard.tsx"), "utf8");
const sessionSrc = readFileSync(join(__dirname, "..", "pages", "session", "[sessionId].tsx"), "utf8");
const messagesSrc = readFileSync(join(__dirname, "..", "components", "MessagesPanel.tsx"), "utf8");

/** The CommunityBoard component's source (it is followed by the roster helpers). */
const boardSrc = dashboardSrc.slice(
  dashboardSrc.indexOf("function CommunityBoard"),
  dashboardSrc.indexOf("function inviteStatusLabel"),
);

describe("F3.1 — Community leads with the feed, composing is on demand", () => {
  it("the permanent 'New post' form is gone; the kit Composer submits the same createThread", () => {
    expect(dashboardSrc).not.toContain("community-compose-card");
    expect(boardSrc).toContain("<Composer");
    expect(boardSrc).toContain("onSubmit={createThread}");
  });

  it("channel-specific fields render inside the expanded composer, not all at once", () => {
    const composerStart = boardSrc.indexOf("<Composer");
    const composerEnd = boardSrc.indexOf("</Composer>");
    expect(composerStart).toBeGreaterThan(-1);
    expect(composerEnd).toBeGreaterThan(composerStart);
    for (const channelFields of [
      '{composeChannel === "MEETUP" && (',
      '{composeChannel === "MOMENTS" && (',
      '{composeChannel === "LOCAL" && (',
    ]) {
      const at = boardSrc.indexOf(channelFields);
      expect(at).toBeGreaterThan(composerStart);
      expect(at).toBeLessThan(composerEnd);
    }
  });

  it("the boxy channel tabs became kit FilterPills and posts render as FeedCards", () => {
    expect(boardSrc).toContain("<FilterPills");
    expect(boardSrc).toContain("<FeedCard");
    expect(dashboardSrc).not.toContain("community-subnav");
  });

  it("empty channels teach via the kit EmptyState; the decorative hero strip is gone", () => {
    expect(boardSrc).toContain("<EmptyState");
    expect(boardSrc).toContain("communityCopy.empty");
    expect(dashboardSrc).not.toContain("icebreaker-hero");
  });

  it("compose validation is inline in the composer — never window.alert", () => {
    expect(boardSrc).not.toContain("window.alert(");
    expect(boardSrc).toContain("setComposeError");
  });

  it("K-6: Moments posts accept title-only, body-only, or photos; untitled cards are photo-first", () => {
    expect(boardSrc).toContain("requireTitle={false}");
    expect(boardSrc).toContain("photoFirst={photoFirst}");
    expect(boardSrc).toContain("hasTitle ? <h4 className=\"community-thread-title\">{t.title}</h4> : null");
  });
});

describe("F3.2 — session Q&A leads with the threads", () => {
  it("the 'Start conversation' form collapsed into an 'Ask a question' Composer", () => {
    expect(sessionSrc).toContain("<Composer");
    expect(sessionSrc).toContain("sessionQaCopy.composer.collapsed");
    expect(sessionSrc).not.toContain('placeholder="Conversation title"');
  });

  it("Top votes / Recent are FilterPills and answered threads wear a status pill", () => {
    expect(sessionSrc).toContain("<FilterPills");
    expect(sessionSrc).toContain("sessionQaCopy.answeredPill");
  });
});

describe("F3.3 — Messages adopts the kit chrome, behavior unchanged", () => {
  it("wayfinding via kit PageHeader; empty inbox via kit EmptyState", () => {
    expect(messagesSrc).toContain("<PageHeader");
    expect(messagesSrc).toContain("<EmptyState");
  });

  it("starting a conversation stays on demand (the picker renders only when invoked)", () => {
    expect(messagesSrc).toMatch(/\{newConversationMode \? \(/);
  });
});
