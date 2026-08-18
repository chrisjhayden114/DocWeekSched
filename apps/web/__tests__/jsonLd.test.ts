import { describe, expect, it } from "vitest";
import { serializeJsonLd } from "../lib/jsonLd";

/**
 * HARDEN-1 (1) — the JSON-LD blocks on /e/[slug] and / are written with
 * dangerouslySetInnerHTML, so the serializer is the only thing standing between
 * an organizer-supplied event name and script execution on a public page.
 */
describe("serializeJsonLd — script-tag breakout", () => {
  const ATTACK = '</script><script>alert(1)</script>';

  it("never emits a raw closing script tag for a hostile event name", () => {
    const out = serializeJsonLd({
      "@context": "https://schema.org",
      "@type": "Event",
      name: ATTACK,
    });
    expect(out).not.toContain("</script");
    expect(out).not.toContain("<");
  });

  it("escapes '<' anywhere it appears — name, description, nested location", () => {
    const out = serializeJsonLd({
      name: ATTACK,
      description: `a <b>bold</b> claim ${ATTACK}`,
      location: { "@type": "Place", name: "<img src=x onerror=alert(1)>" },
      organizer: { "@type": "Organization", name: "</SCRIPT >" },
    });
    expect(out).not.toContain("<");
    expect(out).toContain("\\u003c");
  });

  it("still parses back to the exact original data", () => {
    const data = {
      "@context": "https://schema.org",
      "@type": "Event",
      name: ATTACK,
      startDate: "2026-09-01T09:00:00.000Z",
      location: { "@type": "Place", name: "Hall <A>" },
    };
    expect(JSON.parse(serializeJsonLd(data))).toEqual(data);
  });

  it("leaves payloads with no '<' byte-identical to JSON.stringify", () => {
    const data = { "@type": "Event", name: "Annual Physics Symposium" };
    expect(serializeJsonLd(data)).toBe(JSON.stringify(data));
  });
});
