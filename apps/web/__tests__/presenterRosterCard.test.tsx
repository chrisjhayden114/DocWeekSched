/**
 * @vitest-environment jsdom
 *
 * PRESENTER-ROSTER-1 — the portal card and the session-page panel in each
 * visibility mode. OFF is "do not render", which the pages enforce by only
 * mounting these when the API returned a body.
 */

import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { PresenterRosterSession } from "@event-app/shared";
import {
  PresenterPortalSessionsCard,
  PresenterSessionNotes,
  SessionPresenterRosterPanel,
} from "../components/PresenterRosterCard";
import {
  PRESENTER_PORTAL_SESSIONS_TITLE,
  PRESENTER_ROSTER_EMPTY,
  SESSION_PAGE_PRESENTER_ROSTER_TITLE,
} from "../lib/presenterRoster";

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

let root: Root;
let container: HTMLDivElement;

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
});

function render(node: ReactElement) {
  act(() => {
    root.render(node);
  });
}

const counts: PresenterRosterSession = {
  id: "s1",
  title: "Opening keynote",
  startsAt: "2027-03-01T17:00:00.000Z",
  endsAt: "2027-03-01T18:00:00.000Z",
  roomName: "Hall A",
  joinedCount: 42,
  inPersonCapacity: 60,
  virtualCapacity: null,
  waitlistCount: 3,
};

const names: PresenterRosterSession = {
  ...counts,
  attendees: [
    { displayName: "Priya Shah", affiliation: "Riverside School District" },
    { displayName: "Tom Hale" },
  ],
  hiddenCount: 2,
};

const empty: PresenterRosterSession = {
  ...counts,
  joinedCount: 0,
  waitlistCount: 0,
  inPersonCapacity: null,
};

describe("presenter roster UI", () => {
  it("COUNTS shows title, time, room, seats, and waitlist — and no names", () => {
    render(<PresenterPortalSessionsCard sessions={[counts]} timezone="UTC" />);
    expect(container.textContent).toContain(PRESENTER_PORTAL_SESSIONS_TITLE);
    expect(container.textContent).toContain("Opening keynote");
    expect(container.textContent).toContain("Hall A");
    expect(container.textContent).toContain("42 joined · 60 seats · 3 waiting");
    expect(container.textContent).not.toContain("Priya Shah");
    expect(container.querySelector("details")).toBeNull();
  });

  it("NAMES shows a card grid with muted affiliation and the private remainder", () => {
    render(<PresenterPortalSessionsCard sessions={[names]} timezone="UTC" />);
    expect(container.textContent).toContain("Priya Shah");
    expect(container.textContent).toContain("Riverside School District");
    expect(container.textContent).toContain("Tom Hale");
    expect(container.textContent).toContain("2 names shown, 2 keep their profile private");
    const affiliation = container.querySelector(".text-meta");
    expect(container.innerHTML).toContain("text-meta");
    expect(affiliation).toBeTruthy();
    expect(container.querySelector(".presenter-roster-grid")).toBeTruthy();
    expect(container.querySelector("details")).toBeNull();
  });

  it("an empty session still shows the headline", () => {
    render(<PresenterPortalSessionsCard sessions={[empty]} timezone="UTC" />);
    expect(container.textContent).toContain("0 joined · 0 waiting");
    expect(container.textContent).not.toContain(PRESENTER_ROSTER_EMPTY);
  });

  it("session-page panel uses the presenter-only heading and is absent without data", () => {
    render(<SessionPresenterRosterPanel session={counts} timezone="UTC" />);
    expect(container.textContent).toContain(SESSION_PAGE_PRESENTER_ROSTER_TITLE);
    expect(container.textContent).toContain("42 joined · 60 seats · 3 waiting");
  });

  it("OFF is a missing mount — the pages never render the card without a payload", () => {
    render(<PresenterPortalSessionsCard sessions={[]} timezone="UTC" />);
    expect(container.textContent).toBe("");
  });

  it("renders presenter notes as plain text, newest first, with no link", () => {
    render(
      <PresenterSessionNotes
        notes={[
          { id: "older", body: "See https://example.com/slides", createdAt: "2027-03-01T00:00:00.000Z" },
          { id: "newer", body: "Bring one question.", createdAt: "2027-03-02T00:00:00.000Z" },
        ]}
      />,
    );
    expect(container.querySelector("h2")?.textContent).toBe("From the presenter");
    const items = [...container.querySelectorAll("li")].map((li) => li.textContent);
    expect(items).toEqual(["Bring one question.", "See https://example.com/slides"]);
    expect(container.querySelector("a")).toBeNull();
    const page = readFileSync(join(__dirname, "../pages/session/[sessionId].tsx"), "utf8");
    expect(page).toContain("PresenterSessionNotes");
  });

  it("the session page only mounts the panel after presenter-roster succeeds", () => {
    const page = readFileSync(join(__dirname, "../pages/session/[sessionId].tsx"), "utf8");
    expect(page).toContain("/sessions/${sessionId}/presenter-roster");
    expect(page).toContain("SessionPresenterRosterPanel");
    expect(page).toContain("{presenterRoster && event ?");
    expect(page).toContain("setPresenterRoster(null)");
    const card = readFileSync(join(__dirname, "../components/PresenterRosterCard.tsx"), "utf8");
    expect(card).toContain("SESSION_PAGE_PRESENTER_ROSTER_TITLE");
  });
});
