/**
 * @vitest-environment jsdom
 *
 * ACCT-1 — /account section cards: org-gated plan/billing + organizations,
 * password form validation, and the page still lists sections in the
 * designed order with UX-3 back-nav / danger-zone last.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act, type ReactElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { AccountEmailPasswordCard } from "../components/account/AccountEmailPasswordCard";
import { AccountOrganizationsCard, AccountPlanBillingCard } from "../components/account/AccountOrgSections";
import { EMAIL_CHANGE_COPY } from "../lib/accountSettings";

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

vi.mock("../lib/api", () => ({
  apiFetch: vi.fn(),
}));

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

const orgs = [{ id: "org1", name: "Northbridge", role: "OWNER" }];
const plans = [{ orgId: "org1", orgName: "Northbridge", planName: "Pro monthly" }];

describe("account page renders sections conditionally", () => {
  it("omits plan & billing and organizations when there are no memberships", () => {
    render(
      <>
        <AccountPlanBillingCard orgs={[]} plans={[]} />
        <AccountOrganizationsCard orgs={[]} />
      </>,
    );
    expect(container.textContent).toBe("");
    expect(container.querySelector('[data-account-section="plan-billing"]')).toBeNull();
    expect(container.querySelector('[data-account-section="organizations"]')).toBeNull();
  });

  it("renders plan name + billing link and org name + role when memberships exist", () => {
    render(
      <>
        <AccountPlanBillingCard orgs={orgs} plans={plans} />
        <AccountOrganizationsCard orgs={orgs} />
      </>,
    );
    expect(container.textContent).toContain("Plan & billing");
    expect(container.textContent).toContain("Northbridge");
    expect(container.textContent).toContain("Pro monthly");
    expect(container.querySelector('a[href="/organizer/billing"]')?.textContent).toContain(
      "Manage plan & billing",
    );
    expect(container.textContent).toContain("Your organizations");
    expect(container.textContent).toContain("Owner");
    expect(container.querySelector('a[href="/organizer"]')?.textContent).toBe("Northbridge");
    expect(container.textContent).not.toMatch(/upgrade|upsell|start a trial/i);
  });
});

function setReactInput(el: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  setter?.call(el, value);
  act(() => {
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

describe("password form validation", () => {
  it("blocks submit when the confirmation does not match", () => {
    render(<AccountEmailPasswordCard email="ada@example.com" />);
    const current = container.querySelector('input[autocomplete="current-password"]') as HTMLInputElement;
    const [next, confirm] = Array.from(
      container.querySelectorAll('input[autocomplete="new-password"]'),
    ) as HTMLInputElement[];
    setReactInput(current, "OldPass12!");
    setReactInput(next, "NewPass34!");
    setReactInput(confirm, "Mismatch99!");
    const form = container.querySelector("form")!;
    act(() => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    expect(container.textContent).toContain("New password and confirmation don't match.");
  });

  it("shows the honest email-change line and a read-only email field", () => {
    render(<AccountEmailPasswordCard email="ada@example.com" />);
    expect(container.textContent).toContain(EMAIL_CHANGE_COPY);
    const email = container.querySelector('input[type="email"]') as HTMLInputElement;
    expect(email.value).toBe("ada@example.com");
    expect(email.readOnly).toBe(true);
  });
});

describe("ACCT-1 page anatomy", () => {
  const page = readFileSync(join(__dirname, "..", "pages", "account.tsx"), "utf8");

  it("orders section cards and keeps danger zone last", () => {
    const order = [
      "ProfileEditor",
      "AccountEmailPasswordCard",
      "AccountNotificationDefaultsCard",
      "AccountPlanBillingCard",
      "AccountOrganizationsCard",
      "Data &amp; privacy",
      "Download your data",
      "danger-zone",
    ];
    let cursor = 0;
    for (const needle of order) {
      const at = page.indexOf(needle, cursor);
      expect(at, needle).toBeGreaterThan(-1);
      cursor = at + 1;
    }
  });

  it("does not invent a change-email route", () => {
    expect(page).not.toContain("change-email");
    expect(page).not.toContain("/auth/change-email");
  });

  it("keeps browser Back / the UX-3 back-nav exactly", () => {
    expect(page.indexOf("← Back to dashboard")).toBeLessThan(page.indexOf("<h1"));
    expect(page.match(/Back to dashboard/g)).toHaveLength(1);
  });
});
