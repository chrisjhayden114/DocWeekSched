/**
 * @vitest-environment jsdom
 *
 * PRESENTER-HOME-A — presenter home header, session cards, roster modes,
 * and the public agenda's ?session= deep link.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act, type ReactElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  shapeDirectoryVisibleAttendee,
  shapePortalEvent,
  shapePortalSessionDetail,
  shapePortalSpeaker,
  type PresenterRosterSession,
} from "@event-app/shared";
import { PresenterPortalSessionsCard } from "../components/PresenterRosterCard";
import PresenterPortalPage from "../pages/r/[token]";
import PublicEventPage, { type PublicEventView } from "../pages/e/[slug]";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={typeof href === "string" ? href : ""} {...rest}>
      {children}
    </a>
  ),
}));

vi.mock("next/head", () => ({
  default: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

const routerState = {
  isReady: true,
  pathname: "/r/[token]",
  query: {} as Record<string, string | string[]>,
  replace: vi.fn(),
  push: vi.fn(),
  asPath: "/r/tok",
};

vi.mock("next/router", () => ({
  useRouter: () => routerState,
}));

vi.mock("../lib/api", () => ({
  API_URL: "http://localhost:4000",
  apiFetch: vi.fn().mockRejectedValue(new Error("no session")),
  clearAuthClientState: vi.fn(),
}));

vi.mock("../lib/timezones", async () => {
  const actual = await vi.importActual<typeof import("../lib/timezones")>("../lib/timezones");
  return { ...actual, browserTimezone: () => "Europe/London" };
});

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

let root: Root;
let container: HTMLDivElement;
const scrolled: Element[] = [];
let narrowRoster = false;

function installMatchMedia() {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: (query: string) => ({
      matches: query.includes("hover") ? true : query.includes("479") ? narrowRoster : false,
      media: query,
      addEventListener() {},
      removeEventListener() {},
      addListener() {},
      removeListener() {},
      onchange: null,
      dispatchEvent: () => false,
    }),
  });
}

function identityKeys(value: unknown): string[] {
  const found: string[] = [];
  const walk = (node: unknown) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const item of node) walk(item);
      return;
    }
    for (const [key, child] of Object.entries(node as Record<string, unknown>)) {
      if (key === "email" || key === "userId" || key === "joinMode") found.push(key);
      walk(child);
    }
  };
  walk(JSON.parse(JSON.stringify(value)) as unknown);
  return found;
}

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  Element.prototype.getBoundingClientRect = function rect() {
    return {
      top: 200,
      bottom: 280,
      left: 100,
      right: 700,
      width: 600,
      height: 80,
      x: 100,
      y: 200,
      toJSON() {},
    };
  } as never;
});

beforeEach(() => {
  narrowRoster = false;
  installMatchMedia();
  Object.defineProperty(window, "innerWidth", { writable: true, configurable: true, value: 1200 });
  Object.defineProperty(window, "innerHeight", { writable: true, configurable: true, value: 900 });
  scrolled.length = 0;
  Element.prototype.scrollIntoView = function (this: Element) {
    scrolled.push(this);
  };
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  routerState.isReady = true;
  routerState.query = {};
  routerState.replace.mockReset();
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

async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

const homeSession: PresenterRosterSession = {
  id: "sess-1",
  title: "Opening keynote",
  description: "How organizers reduce noise without losing energy.",
  startsAt: "2027-03-01T17:00:00.000Z",
  endsAt: "2027-03-01T18:00:00.000Z",
  roomName: "Hall A",
  trackName: "Keynote",
  trackColor: "#0033A0",
  format: "keynote",
  zoomLink: "https://example.com/zoom",
  joinedCount: 42,
  inPersonCapacity: 60,
  virtualCapacity: null,
  waitlistCount: 3,
  items: [
    {
      title: "What a calm learning day actually protects",
      abstract: "Which parts of the school day can go quiet.",
      authors: [
        { name: "Maya Chen", isPresenter: true },
        { name: "Jonas Okonkwo", isPresenter: false },
      ],
    },
  ],
};

describe("presenter home payload", () => {
  it("serializes with no email or userId keys", () => {
    const leaked = {
      id: "user_1",
      email: "priya.shah@demo.readyhall.com",
      userId: "user_1",
      name: "Priya Shah",
      title: "Grade 4 teacher",
      affiliation: "Riverside School District",
      photoUrl: "/demo/speakers/priya-shah.svg",
      bio: "Plans the morning block so reading is not the thing that gets squeezed.",
      joinMode: "IN_PERSON",
    };
    const paperAuthors = [
      { name: "Maya Chen", isPresenter: true, speakerId: "spk_1", email: "maya@example.com" },
    ];
    const payload = {
      speaker: shapePortalSpeaker({
        name: "Maya Chen",
        title: "Instructional Coach",
        affiliation: "Riverside School District",
        bio: "Leads professional learning at a K-12 school.",
        photoUrl: "/demo/speakers/maya-chen.svg",
      }),
      event: shapePortalEvent({
        name: "Teaching institute",
        dates: "Mar 1 – 2, 2027",
        timezone: "America/Los_Angeles",
        displayLogoUrl: null,
        brandColor: null,
        startDate: "2027-03-01T17:00:00.000Z",
        endDate: "2027-03-02T21:00:00.000Z",
        venueName: "Riverside Learning Center",
        slug: "demo",
      }),
      sessions: [
        {
          ...shapePortalSessionDetail({
            description: homeSession.description ?? null,
            trackName: "Keynote",
            trackColor: "#0033A0",
            format: "keynote",
            zoomLink: null,
            items: [
              {
                title: "What a calm learning day actually protects",
                abstract: "Which parts of the school day can go quiet.",
                authors: paperAuthors,
              },
            ],
          }),
          attendees: [shapeDirectoryVisibleAttendee(leaked)],
        },
      ],
    };
    const raw = JSON.stringify(payload);
    expect(raw).not.toMatch(/"email"/);
    expect(raw).not.toMatch(/"userId"/);
    expect(raw).not.toMatch(/"joinMode"/);
    expect(identityKeys(payload)).toEqual([]);
    expect(payload.sessions[0]!.attendees?.[0]?.bio).toContain("morning block");
    expect(raw).not.toContain("priya.shah@demo.readyhall.com");
    expect(raw).not.toContain("user_1");
  });
});

describe("presenter home session card", () => {
  it("renders description, papers, track, format, local time, and links", () => {
    render(
      <PresenterPortalSessionsCard sessions={[homeSession]} timezone="America/Los_Angeles" eventSlug="demo" />,
    );
    expect(container.textContent).toContain("How organizers reduce noise without losing energy.");
    expect(container.textContent).toContain("What a calm learning day actually protects");
    expect(container.textContent).toContain("Which parts of the school day can go quiet.");
    const presenter = container.querySelector(".session-peek-paper-authors strong");
    expect(presenter?.textContent).toBe("Maya Chen");
    expect(container.textContent).toContain("Jonas Okonkwo");
    expect(container.querySelector(".session-peek-track")?.textContent).toContain("Keynote");
    expect(container.querySelector(".session-peek-format")).toBeNull();
    expect(container.textContent).toContain("Hall A");
    expect(container.textContent).toContain("42 joined · 60 seats · 3 waiting");
    expect(container.textContent).toContain("(");
    const schedule = container.querySelector("a[href='/e/demo?session=sess-1']");
    expect(schedule?.textContent).toBe("Open in the conference schedule");
    const program = [...container.querySelectorAll("a")].find((a) => a.textContent === "Full program");
    expect(program?.getAttribute("href")).toBe("/e/demo");
    const join = [...container.querySelectorAll("a")].find((a) => a.textContent === "Join online");
    expect(join?.getAttribute("href")).toBe("https://example.com/zoom");
  });

  it("hides Join online when zoomLink is unset", () => {
    render(
      <PresenterPortalSessionsCard
        sessions={[{ ...homeSession, zoomLink: null }]}
        timezone="America/Los_Angeles"
        eventSlug="demo"
      />,
    );
    expect(container.textContent).not.toContain("Join online");
  });

  it("NAMES is a roster grid; COUNTS is the counts line; an empty list is nothing", () => {
    const people: PresenterRosterSession = {
      ...homeSession,
      zoomLink: null,
      attendees: [
        {
          displayName: "Priya Shah",
          title: "Grade 4 teacher",
          affiliation: "Riverside School District",
          photoUrl: "/demo/speakers/priya-shah.svg",
        },
        { displayName: "Tom Hale", title: "Math coach" },
      ],
      hiddenCount: 1,
    };
    render(<PresenterPortalSessionsCard sessions={[people]} timezone="America/Los_Angeles" eventSlug="demo" />);
    expect(container.querySelector(".presenter-roster-grid")).toBeTruthy();
    expect(container.querySelector("img")?.getAttribute("src")).toBe("/demo/speakers/priya-shah.svg");
    expect(container.textContent).toContain("Grade 4 teacher");
    expect(container.textContent).toContain("Riverside School District");
    expect(container.textContent).toContain("TH");
    expect(container.textContent).toContain("2 names shown, 1 keep their profile private");
    expect(container.querySelector("details")).toBeNull();

    render(
      <PresenterPortalSessionsCard
        sessions={[{ ...homeSession, zoomLink: null }]}
        timezone="America/Los_Angeles"
      />,
    );
    expect(container.querySelector(".presenter-roster-grid")).toBeNull();
    expect(container.textContent).toContain("42 joined · 60 seats · 3 waiting");
    expect(container.textContent).not.toContain("Priya Shah");

    render(<PresenterPortalSessionsCard sessions={[]} timezone="America/Los_Angeles" />);
    expect(container.textContent).toBe("");
  });

  it("lays the roster out as 4, 2, and 1 columns", () => {
    const css = readFileSync(join(__dirname, "../styles/globals.css"), "utf8");
    expect(css).toMatch(/\.presenter-roster-grid \{[^}]*grid-template-columns:\s*repeat\(4, minmax\(0, 1fr\)\)/);
    expect(css).toMatch(
      /@media \(max-width: 959px\) \{[^}]*\.presenter-roster-grid \{[^}]*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/,
    );
    expect(css).toMatch(
      /@media \(max-width: 479px\) \{[^}]*\.presenter-roster-grid \{[^}]*grid-template-columns:\s*minmax\(0, 1fr\)/,
    );
    expect(css).toMatch(/\.presenter-roster-avatar\.card-avatar \{[^}]*width:\s*40px/);
  });

  it("searches the full list by bio and pages 24 at a time", () => {
    const attendees = Array.from({ length: 25 }, (_, index) => ({
      displayName: `Person ${String(index + 1).padStart(2, "0")}`,
      title: "Teacher",
      affiliation: index % 2 === 0 ? "Harbor Elementary" : "Northbridge Academy",
      bio: index === 24 ? "keeps bees on the weekend" : "Plans the morning block.",
    }));
    const people: PresenterRosterSession = {
      ...homeSession,
      zoomLink: null,
      attendees,
      hiddenCount: 2,
      truncated: true,
    };
    render(<PresenterPortalSessionsCard sessions={[people]} timezone="UTC" />);
    expect(container.textContent).toContain("25 names shown, 2 keep their profile private");
    expect(container.textContent).toContain("Showing the first 500");
    expect(container.querySelectorAll(".presenter-roster-grid li")).toHaveLength(24);
    expect(container.textContent).not.toContain("Person 25");

    const more = [...container.querySelectorAll("button")].find((button) => button.textContent === "Show 24 more");
    act(() => {
      more?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(container.querySelectorAll(".presenter-roster-grid li")).toHaveLength(25);

    const sort = [...container.querySelectorAll("button")].find((button) => button.textContent === "Sort by affiliation");
    act(() => {
      sort?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(container.textContent).toContain("Harbor Elementary");
    expect(container.querySelector(".presenter-roster-group")).toBeTruthy();

    const search = container.querySelector<HTMLInputElement>('input[type="search"]')!;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    setter?.call(search, "bees");
    act(() => {
      search.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(container.textContent).toContain("Person 25");
    expect(container.textContent).not.toContain("Person 01");
    expect(container.querySelectorAll(".presenter-roster-grid li")).toHaveLength(1);
  });

  it("opens the hover card with the bio and closes it on Esc", async () => {
    const people: PresenterRosterSession = {
      ...homeSession,
      zoomLink: null,
      format: "workshop",
      attendees: [
        {
          displayName: "Priya Shah",
          title: "Grade 4 teacher",
          affiliation: "Riverside School District",
          photoUrl: "/demo/speakers/priya-shah.svg",
          bio: "Plans the morning block so reading is not the thing that gets squeezed.",
        },
      ],
      hiddenCount: 0,
    };
    render(<PresenterPortalSessionsCard sessions={[people]} timezone="UTC" />);
    expect(container.querySelector(".session-peek-format")?.textContent).toBe("Workshop");
    const trigger = container.querySelector(".hover-info")!;
    await act(async () => {
      trigger.dispatchEvent(
        new MouseEvent("mouseover", { bubbles: true, cancelable: true, relatedTarget: null }),
      );
      await new Promise((resolve) => setTimeout(resolve, 300));
    });
    const popover = document.body.querySelector(".hover-info-popover");
    expect(popover?.textContent).toContain("Priya Shah");
    expect(popover?.textContent).toContain("Grade 4 teacher");
    expect(popover?.textContent).toContain("Riverside School District");
    expect(popover?.textContent).toContain("Plans the morning block");
    expect(popover?.querySelector("img")?.getAttribute("src")).toBe("/demo/speakers/priya-shah.svg");
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(document.body.querySelector(".hover-info-popover")).toBeNull();
  });
});

const portalView = {
  event: {
    name: "Teaching institute",
    dates: "Mar 1 – 2, 2027",
    timezone: "America/Los_Angeles",
    displayLogoUrl: null,
    brandColor: null,
    startDate: "2027-03-01T17:00:00.000Z",
    endDate: "2027-03-02T21:00:00.000Z",
    venueName: "Riverside Learning Center",
    slug: "demo",
  },
  speakerName: "Maya Chen",
  speaker: {
    name: "Maya Chen",
    title: "Instructional Coach",
    affiliation: "Riverside School District",
    bio: "Leads professional learning at a K-12 school. She still visits classrooms.",
    photoUrl: "/demo/speakers/maya-chen.svg",
  },
  assignments: [
    {
      id: "a-shared",
      requirement: { label: "Slides", helpText: null, kind: "file", config: {}, required: true },
      dueAt: null,
      status: "READY",
      latestSubmission: {
        id: "sub-1",
        submittedAt: "2027-03-01T00:00:00.000Z",
        approvedAt: "2027-03-01T01:00:00.000Z",
        rejectedAt: null,
        rejectedReason: null,
        fileName: "deck.pdf",
        fileMime: "application/pdf",
        sharedWithAttendees: true,
      },
    },
    {
      id: "a-private",
      requirement: { label: "Bio", helpText: null, kind: "short_text", config: {}, required: true },
      dueAt: null,
      status: "READY",
      latestSubmission: {
        id: "sub-2",
        value: "A short bio.",
        submittedAt: "2027-03-01T00:00:00.000Z",
        approvedAt: "2027-03-01T01:00:00.000Z",
        rejectedAt: null,
        rejectedReason: null,
        sharedWithAttendees: false,
      },
    },
  ],
};

function jsonResponse(body: unknown, ok = true) {
  return {
    ok,
    status: ok ? 200 : 404,
    json: async () => body,
  };
}

describe("presenter portal page", () => {
  it("renders the header from the speaker and the agenda line only when a submission is shared", async () => {
    routerState.pathname = "/r/[token]";
    routerState.query = { token: "tok" };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (String(url).endsWith("/sessions")) {
          return jsonResponse({
            sessions: [{ ...homeSession, attendees: undefined, zoomLink: null }],
          });
        }
        return jsonResponse(portalView);
      }),
    );
    render(<PresenterPortalPage />);
    await flush();
    expect(container.querySelector(".presenter-home-photo img")?.getAttribute("src")).toBe(
      "/demo/speakers/maya-chen.svg",
    );
    expect(container.textContent).toContain("Maya Chen");
    expect(container.textContent).toContain("Instructional Coach, Riverside School District");
    expect(container.textContent).toContain("Leads professional learning at a K-12 school.");
    const speakerCard = container.querySelector(".presenter-home");
    expect(speakerCard?.textContent).not.toContain("Teaching institute");
    expect(speakerCard?.textContent).not.toContain("Mar 1 – 2, 2027");
    expect(speakerCard?.textContent).not.toContain("Riverside Learning Center");
    expect(speakerCard?.nextElementSibling?.classList.contains("event-hero")).toBe(true);
    expect(container.querySelector(".event-hero-name")?.textContent).toBe("Teaching institute");
    expect(container.querySelector(".event-hero-dates")?.textContent).toBe("Mar 1 – 2, 2027");
    expect(container.textContent).toContain(
      "This is your presenter page. Come back any time to see your sessions, who has joined, and your materials.",
    );
    expect(container.textContent).toContain("On the agenda for attendees");
    const privateCard = [...container.querySelectorAll("section")].find((section) =>
      section.textContent?.includes("Bio"),
    );
    expect(privateCard?.textContent).toContain("Approved ✓");
    expect(privateCard?.textContent).not.toContain("On the agenda for attendees");
    expect(container.querySelector(".presenter-portal")?.getAttribute("style")).toContain("overflow-x: clip");
    expect(container.querySelector("main")?.getAttribute("style")).toContain("max-width: 960px");
    expect(container.querySelector("main")?.getAttribute("style")).not.toContain("640");
  });

  it("OFF hides the sessions card", async () => {
    routerState.pathname = "/r/[token]";
    routerState.query = { token: "tok" };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (String(url).endsWith("/sessions")) return jsonResponse({ reason: "unknown" }, false);
        return jsonResponse(portalView);
      }),
    );
    render(<PresenterPortalPage />);
    await flush();
    expect(container.textContent).toContain("Maya Chen");
    expect(container.textContent).not.toContain("Your sessions");
    expect(container.textContent).not.toContain("Opening keynote");
  });
});

const publicEvent: PublicEventView = {
  id: "evt",
  name: "Teaching institute",
  slug: "demo",
  description: null,
  bannerUrl: null,
  logoUrl: null,
  brandColor: null,
  timezone: "America/Los_Angeles",
  startDate: "2027-03-01T17:00:00.000Z",
  endDate: "2027-03-02T21:00:00.000Z",
  venueName: "Riverside Learning Center",
  venueAddress: null,
  showPoweredByBadge: false,
  sessions: [
    {
      id: "sess-1",
      title: "Opening keynote",
      description: "How organizers reduce noise without losing energy.",
      location: null,
      startsAt: "2027-03-01T17:00:00.000Z",
      endsAt: "2027-03-01T18:00:00.000Z",
      trackName: "Keynote",
      roomName: "Hall A",
      speakers: [],
      items: [],
    },
    {
      id: "sess-2",
      title: "Other session",
      description: null,
      location: null,
      startsAt: "2027-03-01T19:00:00.000Z",
      endsAt: "2027-03-01T20:00:00.000Z",
      trackName: null,
      roomName: null,
      speakers: [],
      items: [],
    },
  ],
  speakers: [],
  sponsors: [],
};

describe("public agenda ?session=", () => {
  it("opens the pinned peek on that card and scrolls it into view", async () => {
    routerState.pathname = "/e/[slug]";
    routerState.query = { slug: "demo", session: "sess-1" };
    render(<PublicEventPage event={publicEvent} slug="demo" notFound={false} />);
    await flush();
    const card = document.getElementById("session-sess-1");
    expect(card?.getAttribute("aria-expanded")).toBe("true");
    expect(scrolled).toContain(card);
    expect(document.body.textContent).toContain("Press Escape to close");
    expect(document.body.textContent).toContain("Opening keynote");
  });

  it("does nothing when the id is not in the loaded program", async () => {
    routerState.pathname = "/e/[slug]";
    routerState.query = { slug: "demo", session: "missing" };
    render(<PublicEventPage event={publicEvent} slug="demo" notFound={false} />);
    await flush();
    expect(document.getElementById("session-sess-1")?.getAttribute("aria-expanded")).toBe("false");
    expect(document.body.textContent).not.toContain("Press Escape to close");
  });
});
