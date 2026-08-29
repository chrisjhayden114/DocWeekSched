/**
 * @vitest-environment jsdom
 *
 * K-6 — photo-only community posts render without a title: photos first,
 * then the author line.
 */

import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { FeedCard } from "../components/kit/FeedCard";

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

describe("FeedCard — photo-only community post", () => {
  it("renders photos first, then the author line, and no empty title", () => {
    render(
      <FeedCard
        name="Ada Lovelace"
        meta="Moments · just now"
        photoFirst
        media={
          <div className="moments-grid" data-count={1}>
            <img src="/feature-guide/community_moments.jpg" alt="" />
          </div>
        }
      />,
    );
    const card = container.querySelector<HTMLElement>(".kit-feed-card--photo-first")!;
    expect(card).not.toBeNull();
    const media = card.querySelector(".kit-feed-card-media")!;
    const head = card.querySelector(".kit-feed-card-head")!;
    expect(media.compareDocumentPosition(head) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(head.textContent).toContain("Ada Lovelace");
    expect(card.querySelector(".community-thread-title")).toBeNull();
    expect(card.querySelector(".kit-feed-card-body")).toBeNull();
  });
});
