/**
 * @vitest-environment jsdom
 *
 * K-3 / D6 — floating setup-assistant dock (CHAT-1 shell): FAB, 384px
 * right dock that pushes via body.copilot-docked, per-event sessionStorage,
 * close-on-event-switch. Attendee ConciergeChat is a different page, so the
 * two body classes must never apply together.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { act, type ReactElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AskSetupAssistantLink,
  OrganizerAssistantDock,
  copilotOpenStorageKey,
  openOrganizerAssistantDock,
} from "../components/OrganizerAssistantDock";

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

vi.mock("../components/SetupCopilotChat", () => ({
  SetupCopilotChat: ({ eventId }: { eventId?: string }) => (
    <div data-testid="setup-copilot-chat">{eventId}</div>
  ),
}));

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

const webRoot = join(__dirname, "..");
const read = (...parts: string[]) => readFileSync(join(webRoot, ...parts), "utf8");

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  const walk = (folder: string) => {
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      const full = join(folder, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".tsx") || entry.name.endsWith(".ts")) {
        out.push(relative(webRoot, full));
      }
    }
  };
  walk(join(webRoot, dir));
  return out;
}

function mockDesktop(matches: boolean) {
  window.matchMedia = ((query: string) =>
    ({
      matches: query.includes("min-width: 1024px") ? matches : false,
      media: query,
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false,
    })) as typeof window.matchMedia;
}

let root: Root;
let container: HTMLDivElement;

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

beforeEach(() => {
  mockDesktop(true);
  sessionStorage.clear();
  document.body.classList.remove("copilot-docked", "concierge-docked");
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.body.classList.remove("copilot-docked", "concierge-docked");
  sessionStorage.clear();
});

function render(element: ReactElement) {
  act(() => root.render(element));
}

function fab() {
  return container.querySelector<HTMLButtonElement>(".copilot-fab");
}

function panel() {
  return container.querySelector<HTMLElement>(".copilot-panel");
}

function sheet() {
  return container.querySelector<HTMLElement>(".copilot-sheet");
}

describe("K-3 — OrganizerAssistantDock", () => {
  it("mounts a FAB when closed", () => {
    render(<OrganizerAssistantDock eventId="ev-a" />);
    expect(fab()).not.toBeNull();
    expect(fab()!.getAttribute("aria-label")).toBe("Open Setup assistant");
    expect(panel()).toBeNull();
    expect(document.body.classList.contains("copilot-docked")).toBe(false);
  });

  it("on desktop, opening docks a 384px aside and sets body.copilot-docked", () => {
    render(<OrganizerAssistantDock eventId="ev-a" />);
    act(() => fab()!.click());
    expect(panel()).not.toBeNull();
    expect(panel()!.getAttribute("aria-label")).toBe("Setup assistant");
    expect(container.querySelector("[data-testid=setup-copilot-chat]")?.textContent).toBe("ev-a");
    expect(document.body.classList.contains("copilot-docked")).toBe(true);
    expect(document.body.classList.contains("concierge-docked")).toBe(false);
    expect(fab()).toBeNull();
  });

  it("persists open state under a per-event sessionStorage key", () => {
    render(<OrganizerAssistantDock eventId="ev-a" />);
    act(() => fab()!.click());
    expect(sessionStorage.getItem(copilotOpenStorageKey("ev-a"))).toBe("1");
    expect(sessionStorage.getItem(copilotOpenStorageKey("ev-b"))).toBeNull();
  });

  it("restores the same event's open state and closes on event switch", () => {
    sessionStorage.setItem(copilotOpenStorageKey("ev-a"), "1");
    render(<OrganizerAssistantDock eventId="ev-a" />);
    expect(panel()).not.toBeNull();
    expect(document.body.classList.contains("copilot-docked")).toBe(true);

    act(() => root.render(<OrganizerAssistantDock eventId="ev-b" />));
    expect(panel()).toBeNull();
    expect(document.body.classList.contains("copilot-docked")).toBe(false);
    expect(fab()).not.toBeNull();
    expect(sessionStorage.getItem(copilotOpenStorageKey("ev-a"))).toBe("1");
  });

  it("Ask the setup assistant → opens the dock", () => {
    render(
      <>
        <AskSetupAssistantLink />
        <OrganizerAssistantDock eventId="ev-a" />
      </>,
    );
    const link = [...container.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("Ask the setup assistant"),
    );
    expect(link).toBeDefined();
    act(() => link!.click());
    expect(panel()).not.toBeNull();
    expect(document.body.classList.contains("copilot-docked")).toBe(true);
  });

  it("openOrganizerAssistantDock opens a mounted dock", () => {
    render(<OrganizerAssistantDock eventId="ev-a" />);
    act(() => openOrganizerAssistantDock());
    expect(panel()).not.toBeNull();
  });

  it("on mobile, opening uses the sheet fallback and does not push via body class", () => {
    mockDesktop(false);
    render(<OrganizerAssistantDock eventId="ev-a" />);
    act(() => fab()!.click());
    expect(sheet()).not.toBeNull();
    expect(panel()).toBeNull();
    expect(document.body.classList.contains("copilot-docked")).toBe(false);
  });

  it("never applies concierge-docked and copilot-docked together", () => {
    render(<OrganizerAssistantDock eventId="ev-a" />);
    act(() => fab()!.click());
    const classes = [...document.body.classList];
    expect(classes).toContain("copilot-docked");
    expect(classes).not.toContain("concierge-docked");
  });
});

describe("K-3 — dock seams (source)", () => {
  it("OrganizerShell mounts the dock only when eventId is set", () => {
    const shell = read("components", "OrganizerShell.tsx");
    expect(shell).toContain("OrganizerAssistantDock");
    expect(shell).toMatch(/\{eventId \? \([\s\S]*<OrganizerAssistantDock/);
  });

  it("home and billing do not pass eventId, so they get no dock", () => {
    expect(read("pages", "organizer", "index.tsx")).toMatch(/<OrganizerShell active="events"/);
    expect(read("pages", "organizer", "index.tsx")).not.toMatch(/<OrganizerShell[^>]*eventId=/);
    expect(read("pages", "organizer", "billing.tsx")).toMatch(/<OrganizerShell active="billing">/);
    expect(read("pages", "organizer", "billing.tsx")).not.toMatch(/<OrganizerShell[^>]*eventId=/);
  });

  it("Overview keeps the checklist and drops the embedded chat toggle", () => {
    const panel = read("components", "SetupAssistantPanel.tsx");
    expect(panel).toContain("AskSetupAssistantLink");
    expect(panel).not.toContain("SetupCopilotChat");
    expect(panel).not.toContain("setChatOpen");
    expect(panel).not.toContain("Hide chat");
    expect(read("pages", "organizer", "events", "[eventId]", "index.tsx")).toContain(
      "<SetupAssistantPanel",
    );
  });

  it("Features tab's static button is the same one-line dock opener", () => {
    const page = read("pages", "organizer", "events", "[eventId]", "index.tsx");
    expect(page).toContain("AskSetupAssistantLink");
    expect(page).not.toContain("SetupCopilotChat");
    expect(page).not.toContain("setAskAssistant");
    expect(page).not.toContain("Hide assistant");
  });

  it("body.copilot-docked mirrors body.concierge-docked's content-push margin", () => {
    const css = read("styles", "globals.css");
    const at = css.indexOf("body.concierge-docked .shell-content,\n  body.copilot-docked .shell-content");
    expect(at).toBeGreaterThan(-1);
    expect(css.slice(at, at + 180)).toContain("margin-right: 384px");
  });

  it("ConciergeChat and the organizer dock never share a page (no double-dock)", () => {
    const offenders = [...sourceFiles("pages"), ...sourceFiles("components")].filter((file) => {
      const src = read(file);
      return src.includes("ConciergeChat") && src.includes("OrganizerAssistantDock");
    });
    expect(offenders).toEqual([]);
  });

  it("ConsoleTabStrip still observes width so More▾ recomputes when the dock opens", () => {
    const strip = read("components", "organizer", "ConsoleTabStrip.tsx");
    expect(strip).toContain("ResizeObserver");
    expect(strip).toContain("observer.observe(strip)");
    expect(strip).toContain("planTabOverflow");
  });
});
