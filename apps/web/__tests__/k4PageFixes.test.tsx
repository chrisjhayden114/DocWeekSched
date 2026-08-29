/**
 * @vitest-environment jsdom
 *
 * K-4 — three independent page fixes:
 *   1. scanner shows a visible notice when BarcodeDetector is missing;
 *   2. sponsors (and check-in) render ListEmpty, not the form, when the
 *      resolved feature is off;
 *   3. Program tracks/rooms use the multi-column grid CSS.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act, type ReactElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

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
  useRouter: () => ({
    query: { eventId: "evt1" },
    push: vi.fn(),
    pathname: "/organizer/events/[eventId]/sponsors",
    isReady: true,
  }),
}));

vi.mock("../components/OrganizerShell", () => ({
  OrganizerShell: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  useOrganizerEvent: () => ({ eventId: "evt1", eventName: "Northbridge", cfpLabel: null }),
}));

const organizerFetch = vi.fn();
vi.mock("../lib/organizerApi", () => ({
  organizerFetch: (...args: unknown[]) => organizerFetch(...args),
}));

const apiFetch = vi.fn();
vi.mock("../lib/api", () => ({
  apiFetch: (...args: unknown[]) => apiFetch(...args),
}));

import EventSponsorsPage from "../pages/organizer/events/[eventId]/sponsors";
import CheckInScannerPage from "../pages/organizer/events/[eventId]/scanner";

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

const webRoot = join(__dirname, "..");
const read = (...parts: string[]) => readFileSync(join(webRoot, ...parts), "utf8");
const globalsCss = read("styles", "globals.css");

let root: Root;
let container: HTMLDivElement;

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  organizerFetch.mockReset();
  apiFetch.mockReset();
  window.localStorage.setItem("token", "test-token");
  delete (window as unknown as { BarcodeDetector?: unknown }).BarcodeDetector;
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function render(element: ReactElement) {
  act(() => root.render(element));
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("K-4 — BarcodeDetector-absent notice", () => {
  it("shows a visible manual-entry notice when BarcodeDetector is missing", async () => {
    organizerFetch.mockResolvedValue({ features: [{ key: "checkin", enabled: true }] });
    apiFetch.mockResolvedValue({ attendees: [] });
    render(<CheckInScannerPage />);
    await flush();
    expect(container.textContent).toContain(
      "Scanning isn't supported in this browser — use manual entry",
    );
    expect(container.querySelector(".scanner-unsupported")).not.toBeNull();
    expect(container.textContent).toContain("How check-in works");
    expect(container.textContent).not.toMatch(/badge/i);
  });

  it("hides the notice when BarcodeDetector exists", async () => {
    (window as unknown as { BarcodeDetector: unknown }).BarcodeDetector = class {
      detect() {
        return Promise.resolve([]);
      }
    };
    organizerFetch.mockResolvedValue({ features: [{ key: "checkin", enabled: true }] });
    apiFetch.mockResolvedValue({ attendees: [] });
    render(<CheckInScannerPage />);
    await flush();
    expect(container.textContent).not.toContain(
      "Scanning isn't supported in this browser — use manual entry",
    );
    expect(container.querySelector(".scanner-unsupported")).toBeNull();
  });
});

describe("K-4 — feature gate renders empty-state, not the form", () => {
  it("sponsors: off → ListEmpty + Features link, no add form", async () => {
    organizerFetch.mockResolvedValue({ features: [{ key: "sponsors", enabled: false }] });
    render(<EventSponsorsPage />);
    await flush();
    expect(container.textContent).toContain("Sponsors is turned off for this event");
    expect(container.querySelector("form")).toBeNull();
    expect(container.textContent).not.toContain("Add sponsor");
    expect(container.textContent).not.toContain("No sponsors yet");
    expect(container.textContent).not.toContain("Feature not available");
    const link = container.querySelector<HTMLAnchorElement>('a[href*="tab=features"]');
    expect(link).not.toBeNull();
    expect(link!.getAttribute("href")).toBe("/organizer/events/evt1?tab=features");
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("scanner: off → ListEmpty, no camera form", async () => {
    organizerFetch.mockResolvedValue({ features: [{ key: "checkin", enabled: false }] });
    render(<CheckInScannerPage />);
    await flush();
    expect(container.textContent).toContain("Check-in is turned off for this event");
    expect(container.querySelector("form")).toBeNull();
    expect(container.querySelector(".scanner-manual")).toBeNull();
    expect(container.querySelector(".scanner-unsupported")).toBeNull();
    expect(container.querySelector('a[href*="tab=features"]')).not.toBeNull();
  });
});

describe("K-4 — program tracks/rooms grid CSS", () => {
  it("uses auto-fill 260px columns and full-width inline edit", () => {
    const program = read("components", "organizer", "ProgramTab.tsx");
    expect(program).toContain('className="program-meta-grid"');
    expect(program).toContain("program-meta-item");
    expect(program).toContain("program-meta-edit");
    expect(globalsCss).toContain("grid-template-columns: repeat(auto-fill, minmax(260px, 1fr))");
    expect(globalsCss).toContain(".program-meta-item");
    expect(globalsCss).toContain("border: 1px solid var(--gray-200)");
    expect(globalsCss).toContain(".program-meta-edit");
    expect(globalsCss).toContain("grid-column: 1 / -1");
  });
});
