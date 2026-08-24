/**
 * @vitest-environment jsdom
 *
 * PAY-T0 — the attendee-facing fee notice renders only when there is a fee to
 * show, and it never becomes a payment gate.
 *
 * The server decides whether the feature is on: with `paid_attendance` off,
 * `payment` arrives as null in both the public payload and /attendees/me. So
 * the web contract worth pinning is that null (and an all-blank fee) renders
 * NOTHING at all — no empty "how to pay" box, no stray heading — and that a
 * real fee renders as information beside the join action rather than in place
 * of it.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { FeeNotice } from "../components/FeeNotice";

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

const fee = {
  priceText: "$120 · $95 members",
  url: "https://buy.stripe.com/test-fee",
  instructions: "POs: email finance@district.org.",
};

describe("FeeNotice — renders only when there is a fee", () => {
  it("renders nothing when the feature is off (payment arrives null)", () => {
    render(<FeeNotice payment={null} />);
    expect(container.textContent).toBe("");
    expect(container.querySelector(".fee-notice")).toBeNull();
  });

  it("renders nothing for an undefined payload from an older API response", () => {
    render(<FeeNotice payment={undefined} />);
    expect(container.querySelector(".fee-notice")).toBeNull();
  });

  it("renders nothing when the feature is on but the organizer filled nothing in", () => {
    render(<FeeNotice payment={{ priceText: null, url: null, instructions: null }} />);
    expect(container.querySelector(".fee-notice")).toBeNull();
    render(<FeeNotice payment={{ priceText: "  ", url: "", instructions: "   " }} />);
    expect(container.querySelector(".fee-notice")).toBeNull();
  });

  it("shows the price, a link to the organizer's own payment page, and the instructions", () => {
    render(<FeeNotice payment={fee} />);
    const notice = container.querySelector(".fee-notice");
    expect(notice).not.toBeNull();
    expect(notice!.textContent).toContain("$120 · $95 members");
    expect(notice!.textContent).toContain("How to pay");
    expect(notice!.textContent).toContain("POs: email finance@district.org.");

    const link = container.querySelector<HTMLAnchorElement>("a[href]");
    expect(link!.href).toBe(fee.url);
    expect(link!.target).toBe("_blank");
    expect(link!.rel).toContain("noopener");
  });

  it("says plainly that the organizer collects the fee, not us", () => {
    render(<FeeNotice payment={fee} />);
    const text = container.textContent || "";
    expect(text).toContain("The organizer collects this fee themselves");
    expect(text).toMatch(/does not process or hold\s+registration payments/);
  });

  it("is informational only — no form, no submit, nothing to block registration", () => {
    render(<FeeNotice payment={fee} />);
    expect(container.querySelector("form")).toBeNull();
    expect(container.querySelector("button")).toBeNull();
    expect(container.querySelector("input")).toBeNull();
  });

  it("drops the 'how to pay' block when there is a price but no way to pay yet", () => {
    render(<FeeNotice payment={{ priceText: "$40", url: null, instructions: null }} />);
    const notice = container.querySelector(".fee-notice");
    expect(notice!.textContent).toContain("$40");
    expect(notice!.textContent).not.toContain("How to pay");
    expect(container.querySelector("a[href]")).toBeNull();
  });

  it("nests its heading under the host page's, so the public page keeps one h1", () => {
    render(<FeeNotice payment={fee} />);
    expect(container.querySelector("h2")).not.toBeNull();
    render(<FeeNotice payment={fee} headingLevel="h3" />);
    expect(container.querySelector("h3")).not.toBeNull();
    expect(container.querySelector("h1")).toBeNull();
  });
});

describe("the surfaces that mount the notice", () => {
  const webDir = join(__dirname, "..");
  const publicPage = readFileSync(join(webDir, "pages", "e", "[slug].tsx"), "utf8");
  const welcome = readFileSync(join(webDir, "components", "WelcomeFlow.tsx"), "utf8");
  const organizerPage = readFileSync(
    join(webDir, "pages", "organizer", "events", "[eventId]", "index.tsx"),
    "utf8",
  );

  it("the public page renders the notice from the payload, above an unchanged join CTA", () => {
    expect(publicPage).toContain("<FeeNotice payment={event.payment} />");
    expect(publicPage).toContain("Join this event");
  });

  it("the welcome flow renders the notice from the member's own gated payload", () => {
    expect(welcome).toContain("<FeeNotice payment={payment}");
    // Skip and Finish must not depend on payment in any way.
    expect(welcome).toContain("onClick={() => void skip()}");
  });

  it("every organizer payment surface is behind the resolved feature flag", () => {
    expect(organizerPage).toContain('f.key === "paid_attendance"');
    for (const gated of [
      "paidAttendanceEnabled ? (\n              <MarkPaidCsvCard",
      "paidAttendanceEnabled ? <th>Payment</th> : null",
    ]) {
      expect(organizerPage).toContain(gated);
    }
    expect(organizerPage).toContain("event && paidAttendanceEnabled ? (");
  });
});
