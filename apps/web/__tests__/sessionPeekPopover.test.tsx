/**
 * @vitest-environment jsdom
 *
 * AGENDA-1 — the desktop session peek popover: portal + non-modal ARIA, hover
 * intent (open delay, and staying open while the pointer crosses the gap),
 * click-to-pin, keyboard activation with focus restore, and the touch fallback
 * to the bottom sheet.
 */

import { act, useRef, type ReactElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { HOVER_INFO_CLOSE_GRACE_MS, HOVER_INFO_OPEN_DELAY_MS } from "../components/kit/HoverInfo";
import { SessionPeekPopover } from "../components/SessionPeekPopover";
import { SessionPeekSurface } from "../components/SessionPeekSurface";
import { peekCardClick, peekCardKeyDown, useSessionPeek } from "../components/useSessionPeek";
import { PEEK_COPIED_MS } from "../components/SessionPeekContent";

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

let root: Root;
let container: HTMLDivElement;
/** A scrolling ancestor, to prove the popover escapes it via the portal. */
let clipper: HTMLDivElement;

const SESSION = {
  id: "s1",
  title: "Opening keynote: Designing calm learning days",
  description: "How organizers reduce noise without losing energy.",
  room: { id: "r1", name: "Hall A" },
  track: { id: "t1", name: "Keynote", color: "#0033A0" },
  startsAt: "2026-06-08T13:00:00.000Z",
  endsAt: "2026-06-08T14:00:00.000Z",
  speakers: [
    { id: "sp1", name: "Maya Chen", title: "Instructional Coach", photoUrl: "/demo/speakers/maya-chen.svg" },
    { id: "sp2", name: "Jonas Okonkwo", title: "Head of Teaching and Learning" },
  ],
};

function mockHover(matches: boolean) {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: (query: string) => ({
      matches: query.includes("hover") ? matches : false,
      media: query,
      addEventListener() {},
      removeEventListener() {},
      addListener() {},
      removeListener() {},
      onchange: null,
      dispatchEvent: () => false,
    }),
  });
}

function setViewport(width: number, height = 900) {
  Object.defineProperty(window, "innerWidth", { writable: true, configurable: true, value: width });
  Object.defineProperty(window, "innerHeight", { writable: true, configurable: true, value: height });
}

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  // jsdom gives every element a zero rect; a real one makes the placement real.
  Element.prototype.getBoundingClientRect = function rect() {
    return { top: 200, bottom: 280, left: 100, right: 700, width: 600, height: 80, x: 100, y: 200, toJSON() {} };
  } as never;
});

beforeEach(() => {
  mockHover(true);
  setViewport(1440);
  container = document.createElement("div");
  clipper = document.createElement("div");
  clipper.style.overflowY = "auto";
  container.appendChild(clipper);
  document.body.appendChild(container);
  root = createRoot(clipper);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
});

function render(element: ReactElement) {
  act(() => root.render(element));
}

function fire(target: EventTarget, type: string, init: MouseEventInit = {}) {
  act(() => {
    target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, ...init }));
  });
}

function press(target: EventTarget, key: string) {
  act(() => {
    target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
  });
}

function popover() {
  return document.querySelector<HTMLElement>(".session-peek-pop");
}

function sheet() {
  return document.querySelector<HTMLElement>(".session-peek-sheet");
}

/** An agenda with two cards, wired exactly the way the real pages wire it. */
function Agenda({ children }: { children?: ReactNode }) {
  const peek = useSessionPeek();
  const session = peek.openId === SESSION.id ? SESSION : null;
  return (
    <div>
      <article className="schedule-event" data-testid="card-1" {...peek.getCardProps(SESSION.id)}>
        {SESSION.title}
      </article>
      <article className="schedule-event" data-testid="card-2" {...peek.getCardProps("s2")}>
        Another session
      </article>
      <SessionPeekSurface
        peek={peek}
        session={session}
        timeZone="UTC"
        isPublic
        shareUrl="https://readyhall.test/e/demo#session-s1"
        detailsHref="/login?event=demo&intent=join&next=%2Fsession%2Fs1"
      />
      {children}
    </div>
  );
}

function card(n: 1 | 2) {
  return clipper.querySelector<HTMLElement>(`[data-testid="card-${n}"]`)!;
}

describe("popover shell", () => {
  function Harness() {
    const anchorRef = useRef<HTMLButtonElement>(null);
    return (
      <>
        <button type="button" ref={anchorRef}>
          Card
        </button>
        <SessionPeekPopover open anchorRef={anchorRef} titleId="peek-title" onClose={() => {}}>
          <h3 id="peek-title">{SESSION.title}</h3>
        </SessionPeekPopover>
      </>
    );
  }

  it("mounts in the portal root, outside the scrolling ancestor", () => {
    render(<Harness />);
    const pop = popover()!;
    expect(pop).not.toBeNull();
    expect(pop.parentElement).toBe(document.body);
    expect(clipper.contains(pop)).toBe(false);
    expect(pop.style.position).toBe("fixed");
  });

  it("is a non-modal dialog labelled by its title", () => {
    render(<Harness />);
    const pop = popover()!;
    expect(pop.getAttribute("role")).toBe("dialog");
    // Non-modal: the agenda behind it stays available.
    expect(pop.getAttribute("aria-modal")).toBe("false");
    expect(pop.getAttribute("aria-labelledby")).toBe("peek-title");
    expect(document.getElementById(pop.getAttribute("aria-labelledby")!)).not.toBeNull();
  });

  it("draws a caret when it sits beside the card", () => {
    render(<Harness />);
    expect(popover()!.className).toContain("session-peek-pop--right");
    expect(popover()!.querySelector(".session-peek-pop-caret")).not.toBeNull();
  });
});

describe("hover intent", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it("opens only after the shared hover delay", () => {
    render(<Agenda />);
    fire(card(1), "mouseover");
    act(() => {
      vi.advanceTimersByTime(HOVER_INFO_OPEN_DELAY_MS - 1);
    });
    expect(popover()).toBeNull();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(popover()).not.toBeNull();
    expect(popover()!.textContent).toContain("Opening keynote");
  });

  it("stays open when the pointer crosses the gap into the popover", () => {
    render(<Agenda />);
    fire(card(1), "mouseover");
    act(() => {
      vi.advanceTimersByTime(HOVER_INFO_OPEN_DELAY_MS);
    });
    const pop = popover()!;

    fire(card(1), "mouseout");
    act(() => {
      vi.advanceTimersByTime(HOVER_INFO_CLOSE_GRACE_MS - 1);
    });
    expect(popover()).not.toBeNull();

    fire(pop, "mouseover");
    act(() => {
      vi.advanceTimersByTime(HOVER_INFO_CLOSE_GRACE_MS + 50);
    });
    expect(popover()).not.toBeNull();
  });

  it("closes after the grace period when the pointer leaves both", () => {
    render(<Agenda />);
    fire(card(1), "mouseover");
    act(() => {
      vi.advanceTimersByTime(HOVER_INFO_OPEN_DELAY_MS);
    });
    expect(popover()).not.toBeNull();

    fire(card(1), "mouseout");
    act(() => {
      vi.advanceTimersByTime(HOVER_INFO_CLOSE_GRACE_MS);
    });
    expect(popover()).toBeNull();
  });

  it("never opens on hover without a hover-capable pointer", () => {
    mockHover(false);
    render(<Agenda />);
    fire(card(1), "mouseover");
    act(() => {
      vi.advanceTimersByTime(HOVER_INFO_OPEN_DELAY_MS * 4);
    });
    expect(popover()).toBeNull();
    expect(sheet()).toBeNull();
  });
});

describe("click pins", () => {
  it("keeps the popover open after the pointer leaves", () => {
    vi.useFakeTimers();
    render(<Agenda />);
    fire(card(1), "click");
    expect(popover()).not.toBeNull();
    expect(card(1).getAttribute("aria-expanded")).toBe("true");

    fire(card(1), "mouseout");
    act(() => {
      vi.advanceTimersByTime(HOVER_INFO_CLOSE_GRACE_MS * 4);
    });
    expect(popover()).not.toBeNull();
  });

  it("closes on Escape, on an outside click, and on the X", () => {
    render(<Agenda />);

    fire(card(1), "click");
    press(document, "Escape");
    expect(popover()).toBeNull();

    fire(card(1), "click");
    fire(document.body, "mousedown");
    expect(popover()).toBeNull();

    fire(card(1), "click");
    const close = popover()!.querySelector<HTMLButtonElement>(".session-peek-close")!;
    act(() => close.click());
    expect(popover()).toBeNull();
  });

  it("closes when an ancestor scrolls, the way the Select listbox does", () => {
    render(<Agenda />);
    fire(card(1), "click");
    expect(popover()).not.toBeNull();

    act(() => {
      clipper.dispatchEvent(new Event("scroll", { bubbles: false }));
    });
    expect(popover()).toBeNull();
  });

  it("only ever shows one popover — a second card replaces the first", () => {
    render(<Agenda />);
    fire(card(1), "click");
    expect(card(1).getAttribute("aria-expanded")).toBe("true");

    // A pinned popover is not stolen by a passing pointer...
    vi.useFakeTimers();
    fire(card(2), "mouseover");
    act(() => {
      vi.advanceTimersByTime(HOVER_INFO_OPEN_DELAY_MS * 2);
    });
    expect(card(1).getAttribute("aria-expanded")).toBe("true");
    vi.useRealTimers();

    // ...but a deliberate click on the other card moves it.
    fire(card(2), "click");
    expect(document.querySelectorAll(".session-peek-pop").length).toBeLessThanOrEqual(1);
    expect(card(1).getAttribute("aria-expanded")).toBe("false");
    expect(card(2).getAttribute("aria-expanded")).toBe("true");
  });
});

describe("keyboard", () => {
  it("gives every card a button role and a tab stop", () => {
    render(<Agenda />);
    expect(card(1).getAttribute("role")).toBe("button");
    expect(card(1).getAttribute("tabindex")).toBe("0");
    expect(card(1).getAttribute("aria-haspopup")).toBe("dialog");
  });

  it("Enter opens pinned and moves focus into the popover; Escape restores it", () => {
    render(<Agenda />);
    act(() => card(1).focus());
    expect(document.activeElement).toBe(card(1));

    press(card(1), "Enter");
    const pop = popover()!;
    expect(pop).not.toBeNull();
    expect(pop.contains(document.activeElement)).toBe(true);

    press(document, "Escape");
    expect(popover()).toBeNull();
    expect(document.activeElement).toBe(card(1));
  });

  it("Space opens too", () => {
    render(<Agenda />);
    press(card(1), " ");
    expect(popover()).not.toBeNull();
  });
});

describe("touch and narrow viewports", () => {
  it("opens the bottom sheet instead of the popover on a touch device", () => {
    mockHover(false);
    render(<Agenda />);
    fire(card(1), "click");
    expect(popover()).toBeNull();
    expect(sheet()).not.toBeNull();
    // The sheet is the modal surface, and it renders the same content.
    expect(sheet()!.getAttribute("aria-modal")).toBe("true");
    expect(sheet()!.textContent).toContain("Opening keynote");
  });

  it("opens the sheet on a narrow viewport even with a mouse", () => {
    setViewport(600);
    render(<Agenda />);
    fire(card(1), "click");
    expect(popover()).toBeNull();
    expect(sheet()).not.toBeNull();
  });
});

/**
 * The in-app list card used to router.push to /session/:id. It opens the peek
 * now, and "Full details" inside the peek is the deliberate way to the page.
 */
describe("a card click no longer navigates", () => {
  it("routes to the peek and never to the session page", () => {
    const navigate = vi.fn();
    function AgendaCard() {
      const peek = useSessionPeek();
      const peekProps = peek.getCardProps(SESSION.id);
      return (
        <div>
          <article
            className="schedule-event"
            data-testid="card-1"
            {...peekProps}
            onClick={peekCardClick(peekProps, () => navigate(SESSION.id))}
          >
            {SESSION.title}
          </article>
          <SessionPeekSurface
            peek={peek}
            session={peek.openId === SESSION.id ? SESSION : null}
            timeZone="UTC"
            shareUrl="https://readyhall.test/session/s1"
            detailsHref="/session/s1"
            onOpenDetails={() => navigate(SESSION.id)}
          />
        </div>
      );
    }

    render(<AgendaCard />);
    fire(card(1), "click");
    expect(navigate).not.toHaveBeenCalled();
    expect(popover()).not.toBeNull();

    // ...until the attendee asks for the page explicitly.
    const details = [...popover()!.querySelectorAll<HTMLButtonElement>(".session-peek-bar-btn")].find(
      (b) => b.textContent === "Full details",
    )!;
    act(() => details.click());
    expect(navigate).toHaveBeenCalledWith(SESSION.id);
  });

  it("falls back to the old navigation where no peek is wired", () => {
    const navigate = vi.fn();
    const onClick = peekCardClick(undefined, () => navigate("s1"));
    onClick({ target: null } as never);
    expect(navigate).toHaveBeenCalledWith("s1");

    const onKeyDown = peekCardKeyDown(undefined, () => navigate("s2"));
    onKeyDown({ key: "Enter", preventDefault() {} } as never);
    expect(navigate).toHaveBeenCalledWith("s2");
    // A non-activating key does nothing.
    onKeyDown({ key: "Tab", preventDefault() {} } as never);
    expect(navigate).toHaveBeenCalledTimes(2);
  });

  it("lets a control inside the card keep its own click (Join, Star, links)", () => {
    const navigate = vi.fn();
    function WithButton() {
      const peek = useSessionPeek();
      const peekProps = peek.getCardProps(SESSION.id);
      return (
        <article className="schedule-event" data-testid="card-1" {...peekProps}>
          <button type="button" data-testid="join" onClick={() => navigate("joined")}>
            Join
          </button>
        </article>
      );
    }
    render(<WithButton />);
    const join = clipper.querySelector<HTMLButtonElement>('[data-testid="join"]')!;
    fire(join, "click");
    expect(navigate).toHaveBeenCalledWith("joined");
    // The card's peek stayed shut — the click belonged to the button.
    expect(popover()).toBeNull();
  });
});

describe("content", () => {
  it("copies the session URL and shows Copied for 1.5s", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      writable: true,
      configurable: true,
      value: { writeText },
    });
    // Fake timers before the click, so the revert timer is the fake one.
    vi.useFakeTimers();
    render(<Agenda />);
    fire(card(1), "click");
    const link = [...popover()!.querySelectorAll<HTMLButtonElement>(".session-peek-bar-btn")].find(
      (b) => b.textContent === "Link",
    )!;

    await act(async () => {
      link.click();
      await Promise.resolve();
    });
    expect(writeText).toHaveBeenCalledWith("https://readyhall.test/e/demo#session-s1");
    expect(link.textContent).toBe("Copied");

    act(() => {
      vi.advanceTimersByTime(PEEK_COPIED_MS);
    });
    expect(link.textContent).toBe("Link");
  });

  it("shows the meta line, the track chip, speakers with photos, and the public action", () => {
    render(<Agenda />);
    fire(card(1), "click");
    const pop = popover()!;

    // peekMeta's parts, rendered as nodes rather than one string.
    expect(pop.textContent).toContain("Mon, Jun 8 · 1:00 PM – 2:00 PM UTC");
    expect(pop.querySelector(".session-peek-track")!.textContent).toContain("Keynote");
    expect(pop.querySelector(".session-peek-track-dot")).not.toBeNull();

    const avatars = pop.querySelectorAll(".session-peek-avatar");
    expect(avatars.length).toBe(2);
    expect(avatars[0]!.getAttribute("src")).toBe("/demo/speakers/maya-chen.svg");
    // No photo on the second speaker, so initials.
    expect(avatars[1]!.textContent).toBe("JO");

    // Public page: sign in first, and no schedule actions at all.
    expect(pop.textContent).toContain("Join to build your schedule");
    expect(pop.textContent).not.toContain("Add to my schedule");
    expect(pop.querySelector(".session-peek-star")).toBeNull();
  });
});
