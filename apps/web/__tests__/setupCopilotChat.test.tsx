/**
 * @vitest-environment jsdom
 *
 * GUIDE-1 — leftover guide links that the reply did not mention verbatim
 * must still appear as chips (same pattern as ConciergeChat).
 */

import { act, type ReactElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { emptySetupFormState } from "@event-app/shared";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const apiFetch = vi.fn();
vi.mock("../lib/api", () => ({
  apiFetch: (...args: unknown[]) => apiFetch(...args),
}));

import { SetupCopilotChat } from "../components/SetupCopilotChat";

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

let root: Root;
let container: HTMLDivElement;

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => undefined;
});

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  sessionStorage.clear();
  apiFetch.mockReset();
  apiFetch.mockImplementation(async (path: unknown) => {
    if (String(path).startsWith("/ai/setup-copilot/start")) {
      return {
        step: "settings_chat",
        form: emptySetupFormState("UTC"),
        messages: [
          {
            role: "assistant",
            content: "Turn on Registration fees on the Features tab.",
            links: [
              { label: "Features", href: "/organizer/events/evt1?tab=features" },
              { label: "Sponsor outreach", href: "/organizer/events/evt1/sponsors" },
            ],
            aiGenerated: true,
          },
        ],
      };
    }
    throw new Error(`unexpected fetch ${String(path)}`);
  });
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function render(element: ReactElement) {
  act(() => root.render(element));
}

async function flush() {
  for (let i = 0; i < 8; i += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

describe("GUIDE-1 — leftover guide chips in settings mode", () => {
  it("surfaces an unmatched link as a chip next to the reply", async () => {
    render(
      <SetupCopilotChat
        mode="settings"
        eventId="evt1"
        onFormChange={() => undefined}
      />,
    );
    await flush();

    expect(container.textContent).toContain("Turn on Registration fees on the Features tab.");

    const inline = [...container.querySelectorAll("a")].find(
      (a) => a.textContent === "Features" && !a.className.includes("button"),
    );
    expect(inline?.getAttribute("href")).toBe("/organizer/events/evt1?tab=features");

    const chips = [...container.querySelectorAll("a.button.secondary")];
    expect(chips.some((a) => a.textContent === "Sponsor outreach")).toBe(true);
    expect(chips.find((a) => a.textContent === "Sponsor outreach")?.getAttribute("href")).toBe(
      "/organizer/events/evt1/sponsors",
    );
    expect(chips.some((a) => a.textContent === "Features")).toBe(false);
  });
});
