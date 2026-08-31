/**
 * @vitest-environment jsdom
 *
 * ORG-2 — the two surfaces that end things, and the copy that stopped lying.
 *
 * ORG-1 shipped an organization you could rename but never leave: a solo owner
 * met "transfer ownership or close those orgs" on the account page against a
 * product that could do neither. What is pinned here is that the door now
 * exists, that it is hard to walk through by accident (typed confirmation, and
 * a picker that only lists admins), and that a refusal always says what is in
 * the way rather than hiding the button.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  EVENT_ORG_MOVE_NOTE,
  canCloseOrg,
  canTransferOrgOwnership,
  orgCloseConfirmBody,
  orgCloseConfirmationLabel,
  orgTransferConfirmBody,
} from "@event-app/shared";
import { ORGANIZER_GUIDE } from "@event-app/shared";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { EVENT_ORG_LOCKED_NOTE } from "../lib/eventCreationOrg";

const listOrgMembers = vi.fn();
const getOrgCloseState = vi.fn();
const transferOrgOwnership = vi.fn();
const closeOrg = vi.fn();

vi.mock("../lib/organizerApi", () => ({
  listOrgMembers: (...args: unknown[]) => listOrgMembers(...args),
  getOrgCloseState: (...args: unknown[]) => getOrgCloseState(...args),
  transferOrgOwnership: (...args: unknown[]) => transferOrgOwnership(...args),
  closeOrg: (...args: unknown[]) => closeOrg(...args),
  getEventTransferState: vi.fn(),
  transferEventOrganization: vi.fn(),
  organizerFetch: vi.fn(),
}));

// Imported after the mock so the component picks it up.
const { OrgDangerZone } = await import("../components/organizer/OrgDangerZone");

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

const webDir = join(__dirname, "..");
const read = (...parts: string[]) => readFileSync(join(webDir, ...parts), "utf8");

let root: Root;
let container: HTMLDivElement;

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  listOrgMembers.mockReset();
  getOrgCloseState.mockReset();
  transferOrgOwnership.mockReset();
  closeOrg.mockReset();
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function render(element: ReactElement) {
  act(() => root.render(element));
}

async function renderAsync(element: ReactElement) {
  await act(async () => {
    root.render(element);
  });
}

function setInput(el: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  setter?.call(el, value);
  act(() => {
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

function confirmButton() {
  return [...container.querySelectorAll("button")].find((b) =>
    b.className.includes("button-danger"),
  ) as HTMLButtonElement;
}

describe("ConfirmDialog typed confirmation", () => {
  function mount(typed?: string) {
    render(
      <ConfirmDialog
        open
        title="Close this organization?"
        body="It cannot be reopened."
        confirmLabel="Close it for good"
        typedConfirmExpected="Northbridge Schools"
        typedConfirmLabel={orgCloseConfirmationLabel("Northbridge Schools")}
        typedConfirmValue={typed ?? ""}
        onTypedConfirmChange={() => undefined}
        onConfirm={() => undefined}
        onCancel={() => undefined}
      />,
    );
  }

  it("asks for the organization's name, not a generic word", () => {
    mount();
    expect(container.textContent).toContain("Type Northbridge Schools to confirm");
    expect(container.textContent).not.toMatch(/type DELETE/i);
  });

  it("keeps confirm disabled until the name is typed", () => {
    mount("");
    expect(confirmButton().disabled).toBe(true);
    act(() => root.unmount());
    root = createRoot(container);
    mount("Northbridge");
    expect(confirmButton().disabled).toBe(true);
  });

  it("enables confirm on the name, forgiving case and padding", () => {
    mount("  northbridge schools ");
    expect(confirmButton().disabled).toBe(false);
  });

  it("leaves dialogs without a typed phrase exactly as they were", () => {
    render(
      <ConfirmDialog
        open
        title="Discard changes?"
        body="Unsaved edits will be lost."
        onConfirm={() => undefined}
        onCancel={() => undefined}
      />,
    );
    expect(container.querySelector("input")).toBeNull();
    expect(confirmButton().disabled).toBe(false);
  });
});

describe("OrgDangerZone", () => {
  const admins = [
    { userId: "u-owner", name: "Ada", email: "ada@x.edu", role: "OWNER", isSelf: true },
    { userId: "u-admin", name: "Grace", email: "grace@x.edu", role: "ADMIN", isSelf: false },
    { userId: "u-staff", name: "Linus", email: "linus@x.edu", role: "STAFF", isSelf: false },
  ];

  function closeState(over: Partial<Record<string, unknown>> = {}) {
    return {
      organizationId: "org1",
      name: "Northbridge Schools",
      closedAt: null,
      canClose: true,
      blockers: [],
      reasons: [],
      draftEventCount: 1,
      archivedEventCount: 0,
      otherMemberCount: 2,
      ...over,
    };
  }

  function mount(role: string) {
    return renderAsync(
      <OrgDangerZone
        orgId="org1"
        orgName="Northbridge Schools"
        role={role}
        onOwnershipTransferred={() => undefined}
        onClosed={() => undefined}
      />,
    );
  }

  it("renders nothing for an admin — not a disabled button they'd file a ticket about", async () => {
    listOrgMembers.mockResolvedValue({ members: admins, transferTargetRole: "ADMIN" });
    getOrgCloseState.mockResolvedValue(closeState());
    await mount("ADMIN");
    expect(container.innerHTML).toBe("");
    // And it never even asked, so an admin cannot read the member list.
    expect(listOrgMembers).not.toHaveBeenCalled();
  });

  it("offers only admins as transfer targets, and says to promote first", async () => {
    listOrgMembers.mockResolvedValue({ members: admins, transferTargetRole: "ADMIN" });
    getOrgCloseState.mockResolvedValue(closeState());
    await mount("OWNER");

    expect(container.textContent).toContain("Danger zone");
    expect(container.textContent).toMatch(/promote them to admin first/i);

    // Select renders its options into a portal only once opened.
    const trigger = container.querySelector('[role="combobox"]') as HTMLButtonElement;
    act(() => trigger.click());
    const options = [...document.querySelectorAll('[role="option"]')].map((o) => o.textContent);
    expect(options.join(" ")).toContain("grace@x.edu");
    // The STAFF member and the owner themselves are not offerable.
    expect(options.join(" ")).not.toContain("linus@x.edu");
    expect(options.join(" ")).not.toContain("ada@x.edu");
  });

  it("lists every reason a close is blocked, and refuses to offer the button", async () => {
    listOrgMembers.mockResolvedValue({ members: admins, transferTargetRole: "ADMIN" });
    getOrgCloseState.mockResolvedValue(
      closeState({
        canClose: false,
        blockers: [
          { kind: "PUBLISHED_EVENTS", count: 1, names: ["Spring Institute"] },
          { kind: "CERTIFICATES", count: 4 },
        ],
        reasons: ["1 published event — Spring Institute. Archive it first.", "4 certificates have been issued."],
      }),
    );
    await mount("OWNER");

    const blockers = container.querySelector("[data-org-close-blockers]");
    expect(blockers).not.toBeNull();
    expect(blockers!.querySelectorAll("li")).toHaveLength(2);
    expect(blockers!.textContent).toContain("Spring Institute");

    const closeBtn = [...container.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("Close organization"),
    ) as HTMLButtonElement;
    expect(closeBtn.disabled).toBe(true);
  });

  it("gates a clean close behind typing the organization's name", async () => {
    listOrgMembers.mockResolvedValue({ members: admins, transferTargetRole: "ADMIN" });
    getOrgCloseState.mockResolvedValue(closeState());
    closeOrg.mockResolvedValue({ ok: true, closedAt: "now", message: "closed" });
    await mount("OWNER");

    const closeBtn = [...container.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("Close organization"),
    ) as HTMLButtonElement;
    expect(closeBtn.disabled).toBe(false);
    act(() => closeBtn.click());

    // The dialog names the consequences, including who else loses access.
    expect(document.body.textContent).toContain("Type Northbridge Schools to confirm");
    expect(document.body.textContent).toMatch(/2 other members lose access/i);

    const dialogConfirm = [...document.querySelectorAll(".modal-dialog button")].find((b) =>
      b.textContent?.includes("Close it for good"),
    ) as HTMLButtonElement;
    expect(dialogConfirm.disabled).toBe(true);

    const typed = document.querySelector(".modal-dialog input") as HTMLInputElement;
    setInput(typed, "Northbridge Schools");
    expect(closeOrg).not.toHaveBeenCalled();
  });
});

describe("ORG-2 copy tells the truth it used to hedge on", () => {
  it("the organizer guide no longer says transfer and close are impossible", () => {
    const topic = ORGANIZER_GUIDE.find((t) => t.id === "org-settings")!;
    expect(topic.text).not.toMatch(/not possible yet/i);
    expect(topic.text).toMatch(/transfer ownership/i);
    expect(topic.text).toMatch(/close the organization/i);
    // And it explains the draft-only event move plus the fallback.
    expect(topic.text).toMatch(/draft/i);
    expect(topic.text).toMatch(/re-import/i);
  });

  it("the create-event picker stops claiming an event can never move", () => {
    expect(EVENT_ORG_LOCKED_NOTE).not.toMatch(/can't move to a different organization later/);
    expect(EVENT_ORG_LOCKED_NOTE).toMatch(/draft/i);
    expect(EVENT_ORG_MOVE_NOTE).toMatch(/draft/i);
  });

  it("the confirmation bodies name the org and what the actor keeps", () => {
    expect(orgTransferConfirmBody("Northbridge", "Grace")).toContain("Grace");
    expect(orgTransferConfirmBody("Northbridge", "Grace")).toMatch(/you become an admin/i);
    expect(orgCloseConfirmBody("Northbridge", 0)).not.toMatch(/other member/i);
    expect(orgCloseConfirmBody("Northbridge", 1)).toMatch(/1 other member loses access/i);
  });

  it("the role helpers agree that only an owner may act", () => {
    expect(canTransferOrgOwnership("OWNER") && canCloseOrg("OWNER")).toBe(true);
    expect(canTransferOrgOwnership("ADMIN") || canCloseOrg("ADMIN")).toBe(false);
  });
});

describe("ORG-2 page anatomy", () => {
  it("the danger zone is last on the org settings page and quarantined", () => {
    const page = read("pages", "organizer", "org", "settings.tsx");
    expect(page.indexOf("<OrgDangerZone")).toBeGreaterThan(page.indexOf("orgSettingsCopy.save"));
    expect(read("components", "organizer", "OrgDangerZone.tsx")).toContain('className="card danger-zone"');
    // A closed org has no danger zone left to show.
    expect(page).toContain("!org.closedAt");
  });

  it("the account page points at the new path instead of the old dead end", () => {
    const page = read("pages", "account.tsx");
    expect(page).toContain("/organizer/org/settings");
    expect(page).toContain("soleOwnerPath");
    // The old copy asserted a capability that did not exist.
    expect(page).not.toContain("transfer ownership first.");
    expect(page).not.toContain("Transfer ownership or close those orgs before deleting");
  });

  it("the event move is draft-gated and lives outside the settings save form", () => {
    const transfer = read("components", "organizer", "EventOrganizationTransfer.tsx");
    expect(transfer).toContain('status === "DRAFT"');
    expect(transfer).toContain("if (!isDraft || !state) return null");
    // Server decides; the panel does not guess from status alone.
    expect(transfer).toContain("getEventTransferState");
    expect(transfer).toContain("state.canTransfer");

    const settings = read("components", "organizer", "EventSettingsSlideOver.tsx");
    const formEnd = settings.indexOf("</form>");
    expect(formEnd).toBeGreaterThan(-1);
    expect(settings.indexOf("<EventOrganizationTransfer")).toBeGreaterThan(formEnd);
    // The move must never ride along on the settings PUT (that is W-6).
    const putAt = settings.indexOf('organizerFetch("/event/"');
    const putBlock = settings.slice(putAt, settings.indexOf("}),", putAt));
    expect(putBlock).not.toContain("organizationId");
  });
});
