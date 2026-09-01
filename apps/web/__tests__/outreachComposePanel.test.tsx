/**
 * @vitest-environment jsdom
 *
 * The compose-panel mailto control is an <a class="button">. K-7 pins its
 * text color; this test asserts the anchor still has visible accessible
 * text so a black empty box cannot ship again.
 */

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

vi.mock("../lib/organizerApi", () => ({
  organizerFetch: vi.fn(),
}));

import { OutreachComposePanel } from "../components/organizer/OutreachComposePanel";

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
  act(() => root.unmount());
  container.remove();
});

function render(element: ReactElement) {
  act(() => root.render(element));
}

describe("OutreachComposePanel — mailto control", () => {
  it("the email-app anchor has visible accessible text", () => {
    render(
      <OutreachComposePanel
        eventId="evt1"
        prospect={{
          id: "p1",
          orgName: "M Uni",
          contactEmail: "tom@muni.example",
          status: "TO_CONTACT",
        }}
        templates={[]}
        mergeValues={{ eventName: "Northbridge" }}
        onClose={() => undefined}
        onMarkedContacted={() => undefined}
      />,
    );
    const mailto = container.querySelector<HTMLAnchorElement>('a[href^="mailto:"]');
    expect(mailto).toBeTruthy();
    expect(mailto!.className.split(/\s+/)).toContain("button");
    const label = mailto!.textContent?.replace(/\s+/g, " ").trim();
    expect(label).toBe("Open in your email app");
    expect(mailto!.getAttribute("aria-hidden")).toBeNull();
    expect(mailto!.getAttribute("aria-label") ?? label).toMatch(/open in your email app/i);
  });
});
