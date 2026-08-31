/**
 * @vitest-environment jsdom
 *
 * ORG-1 — the two places an organization's identity reaches a user.
 *
 * 1. The public event page. "Hosted by <name>" was plain text with no way to
 *    reach the organizer. It becomes a link when there is a website and grows a
 *    quiet contact mailto when there is a support email — and stays exactly the
 *    plain line it was when there is neither. It never becomes a card, a logo
 *    strip, or an org profile: J-C deferred the public org page deliberately.
 * 2. The create-event wizard, where the org's logo is a SUGGESTION. BRAND-2's
 *    prefill-not-seed doctrine: a create form may propose, but the row it
 *    creates holds only what the organizer could see in the field and chose to
 *    keep. Clearing it has to stick.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { orgSettingsCopy } from "@event-app/config";
import { HostedByLine } from "../components/HostedByLine";
import { orgLogoPrefill } from "../lib/orgLogoPrefill";

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
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function render(element: ReactElement) {
  act(() => root.render(element));
}

const ORG_LOGO = "https://cdn.example.com/org-crest.png";

describe("HostedByLine — the one public surface an organization gets", () => {
  function mount(props: Partial<Parameters<typeof HostedByLine>[0]> = {}) {
    render(
      <HostedByLine
        organizationName="Northbridge Schools"
        websiteUrl={null}
        supportEmail={null}
        {...props}
      />,
    );
    return container.querySelector("p")!;
  }

  it("with nothing filled in, it is the plain line it always was", () => {
    const line = mount();
    expect(line.textContent).toBe("Hosted by Northbridge Schools");
    expect(container.querySelectorAll("a")).toHaveLength(0);
  });

  it("a saved website makes the host name a link, and nothing else changes", () => {
    mount({ websiteUrl: "https://northbridge.edu" });
    const links = container.querySelectorAll("a");
    expect(links).toHaveLength(1);
    expect(links[0]!.getAttribute("href")).toBe("https://northbridge.edu");
    expect(links[0]!.textContent).toBe("Northbridge Schools");
    // Someone else's site opens in its own tab, and cannot reach back at ours.
    expect(links[0]!.getAttribute("target")).toBe("_blank");
    expect(links[0]!.getAttribute("rel")).toContain("noopener");
  });

  it("a saved support email adds a contact mailto beside the name", () => {
    mount({ supportEmail: "events@northbridge.edu" });
    const links = container.querySelectorAll("a");
    expect(links).toHaveLength(1);
    expect(links[0]!.getAttribute("href")).toBe("mailto:events@northbridge.edu");
    expect(links[0]!.textContent).toBe("Contact organizer");
    // The name is still there, unlinked — the contact link did not replace it.
    expect(container.textContent).toContain("Hosted by Northbridge Schools");
  });

  it("with both, the name links out and the contact link sits after it", () => {
    mount({ websiteUrl: "https://northbridge.edu", supportEmail: "events@northbridge.edu" });
    const links = [...container.querySelectorAll("a")];
    expect(links.map((a) => a.getAttribute("href"))).toEqual([
      "https://northbridge.edu",
      "mailto:events@northbridge.edu",
    ]);
    // Still one line, still one paragraph — no layout noise.
    expect(container.querySelectorAll("p")).toHaveLength(1);
  });

  it("renders nothing at all without a host name", () => {
    render(<HostedByLine organizationName={null} websiteUrl="https://x.edu" supportEmail="a@x.edu" />);
    expect(container.innerHTML).toBe("");
    render(<HostedByLine organizationName="   " websiteUrl={null} supportEmail={null} />);
    expect(container.innerHTML).toBe("");
  });

  it("ignores blank fields rather than minting an empty link", () => {
    mount({ websiteUrl: "   ", supportEmail: "  " });
    expect(container.querySelectorAll("a")).toHaveLength(0);
  });
});

describe("orgLogoPrefill — prefill, not seed", () => {
  it("offers the org's logo into an untouched empty field", () => {
    expect(
      orgLogoPrefill({ current: "", orgLogoUrl: ORG_LOGO, lastPrefill: null, organizerEdited: false }),
    ).toEqual({ logoUrl: ORG_LOGO, prefilled: ORG_LOGO });
  });

  it("offers nothing when the organization has no logo", () => {
    for (const orgLogoUrl of [null, undefined, "  "]) {
      expect(
        orgLogoPrefill({ current: "", orgLogoUrl, lastPrefill: null, organizerEdited: false }),
      ).toEqual({ logoUrl: "", prefilled: null });
    }
  });

  it("CLEARING STICKS — the whole point of prefill-not-seed", () => {
    // The organizer deleted the suggestion. Switching organizations (which is
    // what re-runs this) must not put it back.
    expect(
      orgLogoPrefill({ current: "", orgLogoUrl: ORG_LOGO, lastPrefill: ORG_LOGO, organizerEdited: true }),
    ).toEqual({ logoUrl: "", prefilled: ORG_LOGO });
  });

  it("never overwrites a logo the organizer typed or uploaded", () => {
    const theirs = "data:image/jpeg;base64,AAAA";
    expect(
      orgLogoPrefill({ current: theirs, orgLogoUrl: ORG_LOGO, lastPrefill: null, organizerEdited: true }),
    ).toEqual({ logoUrl: theirs, prefilled: null });
  });

  it("swaps one suggestion for another when the organization changes", () => {
    const other = "https://cdn.example.com/other-crest.png";
    expect(
      orgLogoPrefill({
        current: ORG_LOGO,
        orgLogoUrl: other,
        lastPrefill: ORG_LOGO,
        organizerEdited: false,
      }),
    ).toEqual({ logoUrl: other, prefilled: other });
  });

  it("takes its own suggestion back when the new organization has none", () => {
    expect(
      orgLogoPrefill({
        current: ORG_LOGO,
        orgLogoUrl: null,
        lastPrefill: ORG_LOGO,
        organizerEdited: false,
      }),
    ).toEqual({ logoUrl: "", prefilled: null });
  });
});

describe("the wizard suggests through the shared helper, and says so", () => {
  const wizardSrc = read("pages", "organizer", "events", "new.tsx");

  it("decides through orgLogoPrefill rather than inlining the rule", () => {
    expect(wizardSrc).toContain("orgLogoPrefill({");
  });

  it("treats any touch of the logo field as the organizer taking over", () => {
    expect(wizardSrc).toContain("setLogoUserEdited(true)");
  });

  it("labels the suggestion so it reads as an offer, not a fact", () => {
    expect(wizardSrc).toContain("orgSettingsCopy.logoPrefillNote(");
    expect(orgSettingsCopy.logoPrefillNote("Northbridge")).toMatch(/Suggested from Northbridge/);
    expect(orgSettingsCopy.logoPrefillNote("Northbridge")).toMatch(/[Cc]lear it/);
  });

  it("still submits the visible field, never an org logo of its own", () => {
    expect(wizardSrc).toContain("logoUrl: logoUrl.trim() || null");
    expect(wizardSrc).not.toContain("orgLogoUrl:  org.logoUrl");
  });
});

describe("every rendered logo reads displayLogoUrl; every editable one reads logoUrl", () => {
  // ORG-1's invariant: `logoUrl` is the event's OWN logo and `displayLogoUrl`
  // is the one to render. Handing a form the resolved value is exactly how an
  // org logo would get stamped onto an event row on the next save.
  it("the display surfaces render the resolved logo", () => {
    for (const parts of [
      ["pages", "e", "[slug].tsx"],
      ["pages", "dashboard.tsx"],
      ["pages", "session", "[sessionId].tsx"],
      ["pages", "r", "[token].tsx"],
    ]) {
      expect(read(...parts), parts.join("/")).toContain("displayLogoUrl");
    }
  });

  it("the event settings form still edits the event's own logo", () => {
    const settingsSrc = read("components", "organizer", "EventSettingsSlideOver.tsx");
    expect(settingsSrc).toContain("logoUrl: form.logoUrl.trim() || null");
    expect(settingsSrc).not.toContain("displayLogoUrl");
  });

  it("the public page's hosted-by line goes through the shared component", () => {
    const publicSrc = read("pages", "e", "[slug].tsx");
    expect(publicSrc).toContain("<HostedByLine");
    // The old hardcoded text is gone, so there is one place this line lives.
    expect(publicSrc).not.toContain("Hosted by {event.organizationName}");
  });
});

describe("the org settings page is reachable and wears the console chrome", () => {
  const pageSrc = read("pages", "organizer", "org", "settings.tsx");
  const shellSrc = read("components", "OrganizerShell.tsx");

  it("the workspace sidebar links to it", () => {
    expect(shellSrc).toContain('href: "/organizer/org/settings"');
    expect(shellSrc).toContain('id: "org-settings"');
  });

  it("uses ConsoleSubpageHeader with a way back out", () => {
    expect(pageSrc).toContain("ConsoleSubpageHeader");
    expect(pageSrc).toContain("backTo={{ href: \"/organizer\", label: orgSettingsCopy.backLabel }}");
  });

  it("takes every user-facing string from the copy module", () => {
    expect(pageSrc).toContain("orgSettingsCopy.intro");
    expect(pageSrc).toContain("orgSettingsCopy.fields.websiteUrl");
    expect(pageSrc).toContain("orgSettingsCopy.fields.supportEmail");
    expect(pageSrc).toContain("orgSettingsCopy.fields.logo");
    expect(pageSrc).toContain("orgSettingsCopy.readOnly");
  });

  it("clears with an explicit null on every nullable field (FIX-NULL)", () => {
    for (const field of ["websiteUrl", "supportEmail", "logoUrl", "description"]) {
      expect(pageSrc, field).toContain(`${field}: form.${field}.trim() || null`);
      expect(pageSrc, field).not.toContain(`${field}: form.${field}.trim() || undefined`);
    }
  });

  it("collects the logo under the same limits as an event logo", () => {
    expect(pageSrc).toContain("BRANDING_IMAGE_RULES.logo");
    expect(pageSrc).toContain("fileToDataUrl(file, BRANDING_IMAGE_RULES.logo)");
  });

  it("hides the save button from anyone the server would refuse", () => {
    expect(pageSrc).toContain("canEditOrgIdentity(org?.role)");
  });
});
