/**
 * @vitest-environment jsdom
 *
 * READY-SHARE-1 — the requirement editor's auto-share checkbox, driven through
 * the real component: what it reads out of `config.shareByDefault`, what it
 * sends, and which requirements it refuses to offer.
 *
 * The PATCH body is the point. The editor used to omit `config` entirely so
 * that API-set upload rules survived an edit, which also meant a share setting
 * could not be saved from here at all; now it sends the one key it owns and
 * the route merges the rest (apps/api/src/lib/readiness/requirementConfig.ts).
 */

import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

type Call = { path: string; method: string; body: Record<string, unknown> | null };

const calls: Call[] = [];

vi.mock("../lib/organizerApi", () => ({
  organizerFetch: async (path: string, _eventId: string | null, options?: RequestInit) => {
    calls.push({
      path,
      method: (options?.method as string) ?? "GET",
      body: typeof options?.body === "string" ? JSON.parse(options.body) : null,
    });
    if (path === "/readiness/portal-access") return { accesses: [] };
    if (path === "/readiness/overview") return overview();
    return {};
  },
}));

const { ReadinessTab } = await import("../components/organizer/ReadinessTab");

/**
 * Three requirements that between them cover every branch: the Speaker pack's
 * deck (which ships auto-sharing on), a plain file (off), and a confirmation
 * (which can never reach the agenda, so it gets no checkbox).
 */
const overview = () => ({
  templates: [
    {
      id: "tpl-1",
      name: "Speaker pack",
      description: null,
      requirements: [
        {
          id: "req-deck",
          templateId: "tpl-1",
          label: "Slides 16:9",
          helpText: null,
          kind: "file",
          required: true,
          dueAt: null,
          sortOrder: 0,
          config: { deck: true, maxBytes: 50_000_000 },
        },
        {
          id: "req-release",
          templateId: "tpl-1",
          label: "Signed speaker release",
          helpText: null,
          kind: "file",
          required: true,
          dueAt: null,
          sortOrder: 1,
          config: {},
        },
        {
          id: "req-copyright",
          templateId: "tpl-1",
          label: "Copyright cleared",
          helpText: null,
          kind: "confirm",
          required: true,
          dueAt: null,
          sortOrder: 2,
          config: {},
        },
      ],
    },
  ],
  assignments: [],
  subjects: [],
});

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
  calls.length = 0;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

async function render(element: ReactElement) {
  await act(async () => {
    root.render(element);
  });
}

function click(target: Element) {
  act(() => {
    target.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });
}

async function clickAsync(target: Element) {
  await act(async () => {
    target.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });
}

function buttonByText(text: string): HTMLButtonElement {
  const found = [...document.querySelectorAll("button")].find(
    (b) => b.textContent?.trim() === text,
  );
  if (!found) throw new Error(`no button reading “${text}”`);
  return found as HTMLButtonElement;
}

function kebab(label: string): HTMLButtonElement {
  const found = document.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`);
  if (!found) throw new Error(`no kebab labelled “${label}”`);
  return found;
}

/** The requirement row as the template editor lists it. */
function requirementRow(label: string): HTMLElement {
  const found = [...document.querySelectorAll<HTMLElement>(".drawer-body li")].find((li) =>
    li.textContent?.includes(label),
  );
  if (!found) throw new Error(`no requirement row for “${label}”`);
  return found;
}

/** The editor's auto-share checkbox, found by its label rather than its order. */
function shareCheckbox(): HTMLInputElement | null {
  const label = [...document.querySelectorAll("label")].find((el) =>
    el.textContent?.includes("Share approved files with attendees automatically"),
  );
  return label?.querySelector<HTMLInputElement>('input[type="checkbox"]') ?? null;
}

/** A real activation, so React reads the checkbox the browser's way. */
function toggle(input: HTMLInputElement) {
  act(() => input.click());
}

function setInput(el: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  setter?.call(el, value);
  act(() => {
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

/** The Label field of the open requirement form, by its own label text. */
function labelField(): HTMLInputElement {
  const label = [...document.querySelectorAll("label")].find(
    (el) => el.textContent?.trim() === "Label",
  );
  const input = label?.querySelector<HTMLInputElement>("input.input");
  if (!input) throw new Error("no Label field in the open requirement form");
  return input;
}

/** Open the template editor, then the edit form for one requirement. */
async function openRequirementEditor(label: string) {
  await render(<ReadinessTab eventId="evt-1" speakers={[]} sessions={[]} />);
  click(kebab("Actions for Speaker pack"));
  click(buttonByText("Edit template"));
  click(requirementRow(label).querySelector<HTMLButtonElement>(".kebab-trigger")!);
  click(buttonByText("Edit"));
}

const lastPatch = () => calls.filter((c) => c.method === "PATCH").at(-1)!;

describe("READY-SHARE-1 — the requirement editor's auto-share checkbox", () => {
  it("badges the requirements that share on approval, and only those", async () => {
    await render(<ReadinessTab eventId="evt-1" speakers={[]} sessions={[]} />);
    click(kebab("Actions for Speaker pack"));
    click(buttonByText("Edit template"));

    // The deck ships auto-sharing on, so the board has to say so.
    expect(requirementRow("Slides 16:9").textContent).toContain("Auto-shares");
    expect(requirementRow("Signed speaker release").textContent).not.toContain("Auto-shares");
    expect(requirementRow("Copyright cleared").textContent).not.toContain("Auto-shares");
  });

  it("opens ticked for a requirement that already shares, unticked for one that does not", async () => {
    await openRequirementEditor("Slides 16:9");
    expect(shareCheckbox()!.checked).toBe(true);

    await openRequirementEditor("Signed speaker release");
    expect(shareCheckbox()!.checked).toBe(false);
  });

  it("is not offered on a kind that could never reach the agenda", async () => {
    await openRequirementEditor("Copyright cleared");
    expect(shareCheckbox()).toBeNull();
    // And the help text does not linger from a previous kind either.
    expect(document.body.textContent).not.toContain("appears on the agenda for attendees");
  });

  it("sends config.shareByDefault when the organizer ticks it", async () => {
    await openRequirementEditor("Signed speaker release");
    toggle(shareCheckbox()!);
    expect(shareCheckbox()!.checked).toBe(true);
    await clickAsync(buttonByText("Save requirement"));

    expect(lastPatch().path).toBe("/readiness/requirements/req-release");
    expect(lastPatch().body).toMatchObject({
      label: "Signed speaker release",
      kind: "file",
      required: true,
      config: { shareByDefault: true },
    });
  });

  it("sends it off again when the organizer unticks it", async () => {
    await openRequirementEditor("Slides 16:9");
    toggle(shareCheckbox()!);
    expect(shareCheckbox()!.checked).toBe(false);
    await clickAsync(buttonByText("Save requirement"));

    expect(lastPatch().body).toMatchObject({ config: { shareByDefault: false } });
  });

  it("keeps auto-sharing on through an edit that only touched the label", async () => {
    // The live bug this guards: a deck whose config says `deck: true` and
    // nothing else must not be quietly un-shared by renaming it.
    await openRequirementEditor("Slides 16:9");
    setInput(labelField(), "Slides (16:9)");
    await clickAsync(buttonByText("Save requirement"));

    expect(lastPatch().body).toMatchObject({
      label: "Slides (16:9)",
      config: { shareByDefault: true },
    });
  });

  it("sends no config at all for a kind that has no checkbox", async () => {
    // Nothing here owns that requirement's config, so the safe patch is one
    // that says nothing about it.
    await openRequirementEditor("Copyright cleared");
    await clickAsync(buttonByText("Save requirement"));

    expect(lastPatch().path).toBe("/readiness/requirements/req-copyright");
    expect(lastPatch().body).not.toHaveProperty("config");
  });

  it("starts a new requirement unshared, and asks for nothing until it is a file or URL", async () => {
    await render(<ReadinessTab eventId="evt-1" speakers={[]} sessions={[]} />);
    click(kebab("Actions for Speaker pack"));
    click(buttonByText("Edit template"));
    click(buttonByText("Add requirement"));

    // A new requirement starts as Short text, which cannot be shared.
    expect(shareCheckbox()).toBeNull();
  });
});
