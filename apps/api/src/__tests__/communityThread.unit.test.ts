import { describe, expect, it } from "vitest";
import { communityThreadHasContent } from "../lib/communityThread";

describe("communityThreadHasContent — photo / title / description", () => {
  it("accepts a photo-only post", () => {
    expect(communityThreadHasContent({ imageUrls: ["https://cdn.example/moment.jpg"] })).toBe(true);
    expect(communityThreadHasContent({ imageUrl: "https://cdn.example/one.jpg" })).toBe(true);
  });

  it("accepts title-only or description-only", () => {
    expect(communityThreadHasContent({ title: "Hello" })).toBe(true);
    expect(communityThreadHasContent({ body: "Just a caption" })).toBe(true);
  });

  it("rejects a completely empty post (and blank/whitespace-only fields)", () => {
    expect(communityThreadHasContent({})).toBe(false);
    expect(communityThreadHasContent({ title: "  ", body: "", imageUrls: ["", "   "] })).toBe(false);
  });
});
