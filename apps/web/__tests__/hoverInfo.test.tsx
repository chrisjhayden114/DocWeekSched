/**
 * @vitest-environment jsdom
 *
 * K-1 — HoverInfo mounts its popover in kit/Portal and opens/closes from the
 * keyboard (focusin immediate, Escape, blur). Hover delay is not asserted here.
 */

import { act, type ReactElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { FEATURE_GUIDE } from "@event-app/shared";

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));
import {
  HoverInfo,
  HOVER_INFO_CARD_MAX_HEIGHT,
  HOVER_INFO_CLOSE_GRACE_MS,
  HOVER_INFO_GUIDE_ACTION,
  HOVER_INFO_OPEN_DELAY_MS,
  preloadImage,
  isFadeClipped,
} from "../components/kit/HoverInfo";
import { ParticipantLabelsEditor } from "../components/organizer/ParticipantLabelsEditor";

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

let root: Root;
let container: HTMLDivElement;
let clipper: HTMLDivElement;

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

beforeEach(() => {
  container = document.createElement("div");
  clipper = document.createElement("div");
  clipper.className = "console-table-wrap";
  clipper.style.overflowX = "auto";
  container.appendChild(clipper);
  document.body.appendChild(container);
  root = createRoot(clipper);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function render(element: ReactElement) {
  act(() => root.render(element));
}

function press(target: EventTarget, key: string) {
  act(() => {
    target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
  });
}

function tooltip() {
  return document.querySelector<HTMLElement>('[role="tooltip"]');
}

describe("HoverInfo", () => {
  function mount() {
    render(
      <HoverInfo title="Community" body="The whole Community section where people post and reply." appearsIn="Community tab">
        <strong>Community</strong>
      </HoverInfo>,
    );
    return clipper.querySelector<HTMLButtonElement>(".hover-info-trigger")!;
  }

  it("mounts the popover in the portal root, outside a clipping ancestor", () => {
    const trigger = mount();
    act(() => trigger.focus());

    const popover = tooltip();
    expect(popover).not.toBeNull();
    expect(popover!.parentElement).toBe(document.body);
    expect(clipper.contains(popover)).toBe(false);
    expect(popover!.style.position).toBe("fixed");
    expect(popover!.textContent).toContain("Community");
    expect(popover!.textContent).toContain("The whole Community section");
    expect(popover!.textContent).toContain("Appears in: Community tab");
  });

  it("opens on focus with no delay and wires aria-describedby to the tooltip", () => {
    const trigger = mount();
    expect(tooltip()).toBeNull();
    expect(trigger.getAttribute("aria-describedby")).toBeNull();

    act(() => trigger.focus());

    const popover = tooltip()!;
    expect(popover).not.toBeNull();
    expect(trigger.getAttribute("aria-describedby")).toBe(popover.id);
    expect(document.getElementById(popover.id)).toBe(popover);
  });

  it("closes on Escape and restores focus to the trigger", () => {
    const trigger = mount();
    act(() => trigger.focus());
    expect(tooltip()).not.toBeNull();

    press(window, "Escape");
    expect(tooltip()).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("closes on blur", () => {
    const trigger = mount();
    act(() => trigger.focus());
    expect(tooltip()).not.toBeNull();

    act(() => trigger.blur());
    expect(tooltip()).toBeNull();
  });
});

describe("HoverInfo trigger=label", () => {
  function mountLabel() {
    render(
      <HoverInfo trigger="label" hideIcon title="Community" body="Channels, who can post, and how it differs from Messages.">
        <strong>Community</strong>
      </HoverInfo>,
    );
    return clipper.querySelector<HTMLButtonElement>(".hover-info-label")!;
  }

  it("uses the title as the trigger — no ⓘ in the tree", () => {
    const trigger = mountLabel();
    expect(trigger).not.toBeNull();
    expect(trigger.textContent).toContain("Community");
    expect(clipper.textContent).not.toContain("ⓘ");
    expect(clipper.querySelector(".hover-info-trigger")).toBeNull();
  });

  it("opens on focus and closes on Escape, restoring focus to the title", () => {
    const trigger = mountLabel();
    expect(tooltip()).toBeNull();

    act(() => trigger.focus());
    const popover = tooltip()!;
    expect(popover).not.toBeNull();
    expect(popover.textContent).toContain("Channels, who can post");
    expect(popover.textContent).not.toContain("Appears in");
    expect(trigger.getAttribute("aria-describedby")).toBe(popover.id);

    press(window, "Escape");
    expect(tooltip()).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });
});

describe("HoverInfo children shapes (K-6.2 — no Children.only)", () => {
  it("renders a plain string child without throwing (label-button path)", () => {
    expect(() =>
      render(
        <HoverInfo trigger="label" title="Participant labels" body="Organizer-defined labels attendees pick.">
          Participant labels
        </HoverInfo>,
      ),
    ).not.toThrow();
    const trigger = clipper.querySelector<HTMLButtonElement>(".hover-info-label")!;
    expect(trigger).not.toBeNull();
    expect(trigger.textContent).toBe("Participant labels");
    expect(clipper.querySelector(".hover-info-label-slot")).toBeNull();
  });

  it("renders a fragment / multiple children without throwing", () => {
    expect(() =>
      render(
        <HoverInfo trigger="label" title="Multi" body="More than one child is valid label content.">
          <>
            <span>First</span>
            <span>Second</span>
          </>
        </HoverInfo>,
      ),
    ).not.toThrow();
    const trigger = clipper.querySelector<HTMLButtonElement>(".hover-info-label")!;
    expect(trigger).not.toBeNull();
    expect(trigger.textContent).toContain("First");
    expect(trigger.textContent).toContain("Second");
    expect(clipper.querySelector(".hover-info-label-slot")).toBeNull();
  });

  it("detects a single <button> child as the interactive element", () => {
    expect(() =>
      render(
        <HoverInfo trigger="label" hideIcon title="Plans" body="Plan hover copy.">
          <button type="button" className="plan-trigger">
            Pro
          </button>
        </HoverInfo>,
      ),
    ).not.toThrow();
    expect(clipper.querySelector(".hover-info-label")).toBeNull();
    const slot = clipper.querySelector(".hover-info-label-slot");
    expect(slot).not.toBeNull();
    const child = slot!.querySelector<HTMLButtonElement>(".plan-trigger")!;
    expect(child).not.toBeNull();
    expect(child.textContent).toBe("Pro");
  });

  it("Participants panel: ParticipantLabelsEditor string child mounts after hydrate", () => {
    expect(() =>
      render(
        <ParticipantLabelsEditor
          eventId="evt_1"
          event={{
            name: "Northbridge",
            timezone: "America/New_York",
            startDate: "2026-09-01T00:00:00.000Z",
            endDate: "2026-09-03T00:00:00.000Z",
          }}
          labels={["Faculty"]}
          onSaved={() => undefined}
        />,
      ),
    ).not.toThrow();
    const trigger = clipper.querySelector<HTMLButtonElement>(".hover-info-label")!;
    expect(trigger).not.toBeNull();
    expect(trigger.textContent).toBe("Participant labels");
  });
});

describe("isFadeClipped", () => {
  it("is true only when the extract overflows the 6-line window", () => {
    expect(isFadeClipped({ scrollHeight: 80, clientHeight: 80 })).toBe(false);
    expect(isFadeClipped({ scrollHeight: 81, clientHeight: 80 })).toBe(false);
    expect(isFadeClipped({ scrollHeight: 82, clientHeight: 80 })).toBe(true);
    expect(isFadeClipped({ scrollHeight: 200, clientHeight: 135 })).toBe(true);
  });
});

describe("HoverInfo Wikipedia persistence + fade", () => {
  function mockHoverMedia(matches: boolean) {
    window.matchMedia = ((query: string) =>
      ({
        matches: query.includes("hover: hover") ? matches : false,
        media: query,
        onchange: null,
        addListener: () => undefined,
        removeListener: () => undefined,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
        dispatchEvent: () => false,
      })) as typeof window.matchMedia;
  }

  function fire(target: EventTarget, type: "mouseover" | "mouseout") {
    act(() => {
      target.dispatchEvent(
        new MouseEvent(type, {
          bubbles: true,
          cancelable: true,
          relatedTarget: type === "mouseout" ? document.body : null,
        }),
      );
    });
  }

  beforeEach(() => {
    mockHoverMedia(true);
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function mountPreview() {
    render(
      <HoverInfo
        trigger="label"
        title="Community"
        body={"Community is the shared event board. ".repeat(12)}
        image={<svg className="feature-art" viewBox="0 0 400 225" />}
      >
        <strong>Community</strong>
      </HoverInfo>,
    );
    return clipper.querySelector<HTMLElement>(".hover-info")!;
  }

  it("stays open when the pointer travels trigger → card within the grace gap", () => {
    const wrap = mountPreview();
    fire(wrap, "mouseover");
    act(() => {
      vi.advanceTimersByTime(HOVER_INFO_OPEN_DELAY_MS - 1);
    });
    expect(tooltip()).toBeNull();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    const card = tooltip();
    expect(card).not.toBeNull();

    fire(wrap, "mouseout");
    act(() => {
      vi.advanceTimersByTime(HOVER_INFO_CLOSE_GRACE_MS - 1);
    });
    expect(tooltip()).not.toBeNull();

    fire(card!, "mouseover");
    act(() => {
      vi.advanceTimersByTime(HOVER_INFO_CLOSE_GRACE_MS + 50);
    });
    expect(tooltip()).not.toBeNull();
    expect(tooltip()!.className).toContain("hover-info-popover--has-image");
  });

  it("closes after the grace gap if the pointer never reaches the card", () => {
    const wrap = mountPreview();
    fire(wrap, "mouseover");
    act(() => {
      vi.advanceTimersByTime(HOVER_INFO_OPEN_DELAY_MS);
    });
    expect(tooltip()).not.toBeNull();

    fire(wrap, "mouseout");
    act(() => {
      vi.advanceTimersByTime(HOVER_INFO_CLOSE_GRACE_MS);
    });
    expect(tooltip()).toBeNull();
  });

  it("applies the fade-clip class when the extract overflows", () => {
    const proto = HTMLElement.prototype;
    const prevScroll = Object.getOwnPropertyDescriptor(proto, "scrollHeight");
    const prevClient = Object.getOwnPropertyDescriptor(proto, "clientHeight");
    Object.defineProperty(proto, "scrollHeight", {
      configurable: true,
      get() {
        return (this as HTMLElement).classList.contains("hover-info-body") ? 220 : 0;
      },
    });
    Object.defineProperty(proto, "clientHeight", {
      configurable: true,
      get() {
        return (this as HTMLElement).classList.contains("hover-info-body") ? 135 : 0;
      },
    });
    try {
      const wrap = mountPreview();
      fire(wrap, "mouseover");
      act(() => {
        vi.advanceTimersByTime(HOVER_INFO_OPEN_DELAY_MS);
      });
      const body = tooltip()!.querySelector<HTMLElement>(".hover-info-body")!;
      expect(isFadeClipped(body)).toBe(true);
      expect(body.classList.contains("is-clipped")).toBe(true);
    } finally {
      if (prevScroll) Object.defineProperty(proto, "scrollHeight", prevScroll);
      else delete (proto as { scrollHeight?: unknown }).scrollHeight;
      if (prevClient) Object.defineProperty(proto, "clientHeight", prevClient);
      else delete (proto as { clientHeight?: unknown }).clientHeight;
    }
  });

  it("keeps title, body, and footer visible for a long-guide feature with a screenshot", () => {
    const longestKey = (Object.keys(FEATURE_GUIDE) as (keyof typeof FEATURE_GUIDE)[]).reduce((best, key) =>
      FEATURE_GUIDE[key].whatItDoes.length > FEATURE_GUIDE[best].whatItDoes.length ? key : best,
    );
    const longest = FEATURE_GUIDE[longestKey];
    render(
      <HoverInfo
        trigger="label"
        title={longestKey}
        featureKey={longestKey}
        body={longest.whatItDoes}
        imageSrc={longest.imageSrc}
        image={<svg className="feature-art" viewBox="0 0 400 225" />}
      >
        <strong>{longestKey}</strong>
      </HoverInfo>,
    );
    const wrap = clipper.querySelector<HTMLElement>(".hover-info")!;
    fire(wrap, "mouseover");
    act(() => {
      vi.advanceTimersByTime(HOVER_INFO_OPEN_DELAY_MS);
    });
    const card = tooltip()!;
    expect(card).not.toBeNull();
    const footer = card.querySelector<HTMLElement>('[data-hover-slot="footer"]');
    const body = card.querySelector<HTMLElement>('[data-hover-slot="body"]');
    expect(card.querySelector('[data-hover-slot="title"]')?.classList.contains("hover-info-title")).toBe(true);
    expect(card.querySelector('[data-hover-slot="art"]')).not.toBeNull();
    expect(body?.classList.contains("hover-info-body")).toBe(true);
    expect(body?.textContent).toContain(longest.whatItDoes.slice(0, 40));
    expect(footer).not.toBeNull();
    expect(footer?.classList.contains("hover-info-action")).toBe(true);
    expect(footer?.textContent).toBe(HOVER_INFO_GUIDE_ACTION);
    expect(body?.contains(footer)).toBe(false);
    expect(Number.parseFloat(card.style.maxHeight)).toBe(HOVER_INFO_CARD_MAX_HEIGHT);
    if (longest.imageSrc) {
      const img = card.querySelector<HTMLImageElement>(".hover-info-image")!;
      expect(img.getAttribute("src")).toBe(longest.imageSrc);
      expect(img.getAttribute("loading")).toBeNull();
    } else {
      expect(card.querySelector(".feature-art")).not.toBeNull();
    }
  });

  it("preloads imageSrc when the hover-intent timer starts, before the card opens", () => {
    const seen: string[] = [];
    class FakeImage {
      set src(value: string) {
        seen.push(value);
      }
    }
    vi.stubGlobal("Image", FakeImage);
    try {
      render(
        <HoverInfo
          trigger="label"
          title="Share your moments"
          body={FEATURE_GUIDE.community_moments.whatItDoes}
          imageSrc={FEATURE_GUIDE.community_moments.imageSrc}
        >
          <strong>Share your moments</strong>
        </HoverInfo>,
      );
      const wrap = clipper.querySelector<HTMLElement>(".hover-info")!;
      fire(wrap, "mouseover");
      expect(seen).toEqual(["/feature-guide/community_moments.jpg"]);
      expect(tooltip()).toBeNull();
      act(() => {
        vi.advanceTimersByTime(HOVER_INFO_OPEN_DELAY_MS);
      });
      const img = tooltip()!.querySelector<HTMLImageElement>(".hover-info-image")!;
      expect(img.getAttribute("src")).toBe("/feature-guide/community_moments.jpg");
      expect(img.getAttribute("loading")).toBeNull();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("preloadImage is a no-op for an empty src", () => {
    expect(() => preloadImage("")).not.toThrow();
  });
});
