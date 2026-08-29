/**
 * @vitest-environment jsdom
 *
 * K-6.1 — every historical ?tab= id (and junk) renders the event console
 * without throwing. Participants still covers invites.
 */

import { act, type ReactElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { HISTORICAL_EVENT_TAB_IDS } from "../lib/eventTabs";

const routerState = {
  isReady: true,
  pathname: "/organizer/events/[eventId]",
  query: { eventId: "evt1" } as Record<string, string | string[] | undefined>,
  push: vi.fn(),
  replace: vi.fn(),
};

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

vi.mock("next/head", () => ({
  default: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock("next/router", () => ({
  useRouter: () => routerState,
}));

vi.mock("../components/OrganizerShell", () => ({
  OrganizerShell: ({ children }: { children: ReactNode }) => <div data-testid="shell">{children}</div>,
  useOrganizerEvent: () => ({ eventId: "evt1", eventName: "Northbridge", cfpLabel: null }),
}));

vi.mock("../components/VenueMapEditor", () => ({ VenueMapEditor: () => <div>maps-panel</div> }));
vi.mock("../components/AnnouncementComposer", () => ({ AnnouncementComposer: () => <div>announcements-panel</div> }));
vi.mock("../components/OpsInboxPanel", () => ({ OpsInboxPanel: () => <div>ops-panel</div> }));
vi.mock("../components/RecapPanel", () => ({ RecapPanel: () => <div>recap-panel</div> }));
vi.mock("../components/organizer/ReadinessTab", () => ({ ReadinessTab: () => <div>readiness-panel</div> }));
vi.mock("../components/organizer/SpeakersTab", () => ({ SpeakersTab: () => <div>speakers-panel</div> }));
vi.mock("../components/organizer/ProgramTab", () => ({ ProgramTab: () => <div>program-panel</div> }));
vi.mock("../components/organizer/RosterImportCard", () => ({ RosterImportCard: () => <div>roster-import</div> }));
vi.mock("../components/organizer/EventSettingsSlideOver", () => ({
  EventSettingsSlideOver: () => null,
}));
vi.mock("../components/organizer/ParticipantLabelsEditor", () => ({
  ParticipantLabelsEditor: () => null,
}));
vi.mock("../components/FeatureConfigPanel", () => ({
  FeatureConfigPanel: () => <div>features-panel</div>,
}));
vi.mock("../components/SetupAssistantPanel", () => ({ SetupAssistantPanel: () => null }));
vi.mock("../components/EventFaqEditor", () => ({
  AssistantStartersEditor: () => null,
  EventFaqEditor: () => null,
}));
vi.mock("../components/OrganizerAssistantDock", () => ({
  AskSetupAssistantLink: () => <span>ask</span>,
  SETUP_COPILOT_FEATURES_APPLIED: "setup-copilot-features-applied",
}));

const organizerFetch = vi.fn();
vi.mock("../lib/organizerApi", () => ({
  organizerFetch: (...args: unknown[]) => organizerFetch(...args),
  eventHeaders: () => ({ "X-Event-Id": "evt1" }),
}));

const apiFetchAll = vi.fn();
vi.mock("../lib/api", () => ({
  apiFetch: vi.fn(),
  apiFetchAll: (...args: unknown[]) => apiFetchAll(...args),
}));

import OrganizerEventPage from "../pages/organizer/events/[eventId]/index";

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

const EVENT = {
  id: "evt1",
  name: "Northbridge",
  slug: "northbridge",
  status: "DRAFT",
  uiStatus: "draft",
  timezone: "UTC",
  startDate: "2026-09-01T00:00:00.000Z",
  endDate: "2026-09-03T00:00:00.000Z",
  organizationId: "org1",
};

let root: Root;
let container: HTMLDivElement;

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  routerState.query = { eventId: "evt1" };
  routerState.push.mockReset();
  routerState.replace.mockReset();
  organizerFetch.mockReset();
  apiFetchAll.mockReset();
  organizerFetch.mockImplementation(async (path: string) => {
    if (path === "/event/") return EVENT;
    if (path === "/event/invite-links") return { slugUrl: "https://ex/e/northbridge", joinUrl: "https://ex/join" };
    if (path === "/event/features") return { overrides: {}, features: [{ key: "readiness", enabled: true }] };
    return [];
  });
  apiFetchAll.mockResolvedValue([]);
  window.matchMedia = ((query: string) =>
    ({
      matches: query.includes("min-width: 769px") ? false : false,
      media: query,
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false,
    })) as typeof window.matchMedia;
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function render(element: ReactElement) {
  act(() => root.render(element));
}

async function flush() {
  for (let i = 0; i < 6; i += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

describe("K-6.1 — event console tab deep links", () => {
  it("every historical tab id plus a junk value renders without crashing", async () => {
    const ids = [...HISTORICAL_EVENT_TAB_IDS, "not-a-tab", "speakers", "???"];
    for (const id of ids) {
      routerState.query = { eventId: "evt1", tab: id };
      expect(() => render(<OrganizerEventPage />), `render ?tab=${id}`).not.toThrow();
      await flush();
      expect(container.querySelector("[data-testid=shell]"), `shell for ?tab=${id}`).not.toBeNull();
      expect(container.textContent, `chrome for ?tab=${id}`).toContain("Northbridge");
    }
  });

  it("?tab=invites still shows the Participants (invites) surface", async () => {
    routerState.query = { eventId: "evt1", tab: "invites" };
    render(<OrganizerEventPage />);
    await flush();
    expect(container.textContent).toContain("Invite one person");
    expect(container.textContent).toContain("Roster");
    expect(container.textContent).toContain("Participants");
    expect(routerState.replace).toHaveBeenCalled();
    const next = routerState.replace.mock.calls[0][0] as { query: Record<string, string> };
    expect(next.query.tab).toBe("participants");
  });

  it("rewrites a junk ?tab= value to Overview", async () => {
    routerState.query = { eventId: "evt1", tab: "not-a-tab" };
    render(<OrganizerEventPage />);
    await flush();
    expect(container.textContent).not.toContain("Invite one person");
    expect(routerState.replace).toHaveBeenCalled();
    const next = routerState.replace.mock.calls[0][0] as { query: Record<string, string> };
    expect(next.query.tab).toBeUndefined();
    expect(next.query.eventId).toBe("evt1");
  });
});
