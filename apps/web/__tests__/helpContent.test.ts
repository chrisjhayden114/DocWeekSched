/**
 * E1.3 — /help renders from the bundled HELP_SOURCE module (runtime fs reads
 * of content/help/*.md return nothing in the serverless bundle). The .md files
 * stay the human-editable source; this test fails if the two drift.
 */

import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "fs";
import { join } from "path";
import { brand } from "@event-app/config";
import {
  MATERIALS_VISIBILITY_LABELS,
  SESSION_FORMATS,
  SESSION_FORMAT_LABELS,
  SPEAKER_PACK_REQUIREMENTS,
  SPEAKER_PACK_TEMPLATE_NAME,
  inferSessionFormat,
} from "@event-app/shared";
import { applyBrandTokens, listHelpArticles } from "../lib/help/articles";
import { HELP_SOURCE } from "../lib/help/helpContent";
import { PEEK_POPOVER_MIN_WIDTH } from "../lib/sessionPeekSurface";
import { SESSION_CSV_FIELDS } from "../lib/sessionCsv";

const CONTENT_DIR = join(__dirname, "../content/help");

describe("bundled help content matches content/help/*.md", () => {
  const files = readdirSync(CONTENT_DIR).filter((f) => f.endsWith(".md"));

  it("covers exactly the markdown files on disk", () => {
    const diskSlugs = files.map((f) => f.replace(/\.md$/, "")).sort();
    expect(Object.keys(HELP_SOURCE).sort()).toEqual(diskSlugs);
  });

  for (const file of files) {
    const slug = file.replace(/\.md$/, "");
    it(`"${slug}" is byte-identical to its markdown file`, () => {
      const disk = readFileSync(join(CONTENT_DIR, file), "utf8");
      expect(HELP_SOURCE[slug]).toBe(disk);
    });
  }
});

/**
 * HELP-3 — the AGENDA-1/2/3 documentation.
 *
 * Every label the help pages put in bold is asserted against the string in the
 * component that renders it, not against a copy pasted into this file. A
 * renamed toggle then fails here instead of quietly turning a help page into a
 * set of instructions for a control that no longer exists.
 */
describe("HELP-3 — AGENDA-1/2/3 help sections", () => {
  const read = (path: string) => readFileSync(join(__dirname, "..", path), "utf8");
  const help = (slug: string) => read(`content/help/${slug}.md`);

  const readinessTab = read("components/organizer/ReadinessTab.tsx");
  const eventSettings = read("components/organizer/EventSettingsSlideOver.tsx");
  const filterPanel = read("components/AgendaFilterPanel.tsx");
  const cardBits = read("components/SessionCardBits.tsx");

  describe("speaker-readiness — sharing approved materials", () => {
    const md = help("speaker-readiness");

    it("has the section and its visibility sub-section", () => {
      expect(md).toContain("## Sharing approved materials with attendees");
      expect(md).toContain("### Who can open them");
    });

    it("quotes the submission toggle exactly as ReadinessTab renders it", () => {
      expect(readinessTab).toContain("<span>Share with attendees</span>");
      expect(md).toContain("**Share with attendees**");
    });

    it("quotes the event setting exactly as EventSettingsSlideOver renders it", () => {
      expect(eventSettings).toContain('title="Who can open shared materials"');
      expect(md).toContain("**Event settings → More options → Who can open shared materials**");
    });

    it("names both visibility options in the shared vocabulary's words", () => {
      expect(MATERIALS_VISIBILITY_LABELS.ATTENDEES).toBe("People who joined this event");
      expect(MATERIALS_VISIBILITY_LABELS.PUBLIC).toBe("Anyone who can see the public event page");
      for (const label of Object.values(MATERIALS_VISIBILITY_LABELS)) {
        expect(md, label).toContain(`**${label}**`);
      }
      // ATTENDEES is the default, and the page has to say which one that is.
      expect(md).toMatch(/\*\*People who joined this event\*\* — the default/);
    });

    it("states the limits: off by default, file and link only, un-approving un-shares", () => {
      expect(md).toContain("It's off by default, and nothing is shared until you tick it.");
      expect(md).toMatch(/Only \*\*File upload\*\* and \*\*URL\*\* items can be shared at all\./);
      expect(md).toMatch(/\*\*Agreement\*\*.*never can/);
      expect(md).toMatch(/\*\*Reject…\*\* .*un-approves it and un-shares it in the same step/);
    });

    it("names the one requirement that shares on approval, and says there is no switch for it", () => {
      // SPEAKER_PACK_REQUIREMENTS is the only place the product ships
      // shareByDefault, so the help may name that requirement and nothing else.
      const autoShared = SPEAKER_PACK_REQUIREMENTS.filter((r) => r.config?.shareByDefault === true);
      expect(autoShared.map((r) => r.label)).toEqual(["Slides 16:9"]);
      expect(md).toContain("**Slides 16:9**");
      expect(md).toContain(`**${SPEAKER_PACK_TEMPLATE_NAME}**`);
      expect(md).toContain("the requirement editor has no switch for it");
    });

    it("says plainly that turning the feature off withdraws shared materials", () => {
      expect(md).toMatch(
        /Turning \*\*Speaker & Session Readiness\*\* off on the \*\*Features\*\* tab withdraws all of it\./,
      );
      expect(md).toContain("their links stop working");
    });
  });

  describe("presenter-portal — what a presenter should expect", () => {
    const md = help("presenter-portal");

    it("warns that an approved deck may reach the agenda, and that it is opt-in", () => {
      expect(md).toContain("## Your deck may end up on the agenda");
      expect(md).toContain("nothing you send is shared unless they turn it on for that submission");
    });

    it("does not send presenters to a notes field the portal has no room for", () => {
      expect(md).toContain("this page has nowhere to leave a note, so email them");
      expect(read("pages/r/[token].tsx")).not.toMatch(/notes? to the organizer/i);
    });
  });

  describe("attendee-faq — peek, materials, filters", () => {
    const md = help("attendee-faq");

    it("documents the session peek and how it closes", () => {
      expect(md).toContain("## Can I see what a session is about without leaving the Agenda?");
      expect(md).toContain("**Esc**");
      expect(md).toContain("**×**");
      expect(md).toContain("opens as a sheet from the bottom");
      expect(PEEK_POPOVER_MIN_WIDTH).toBe(768);
    });

    it("answers where the slides are, in the card hint's own word", () => {
      expect(md).toContain("## Where are the slides?");
      expect(cardBits).toContain('label = "Slides"');
      expect(md).toContain("**Slides** hint");
      // The card hint is deliberately not a link; the help must not imply it is.
      expect(cardBits).toContain("Never a link");
      expect(md).toContain("the hint isn't a link");
      expect(md).toContain("**Slides available to attendees**");
    });

    it("lists the filter sections exactly as AgendaFilterPanel labels them", () => {
      const labels = ["Filter by format", "Filter by track", "Filter by room", "Speaker"];
      for (const label of labels) {
        expect(filterPanel, label).toContain(`label="${label}"`);
        expect(md, label).toContain(`**${label}**`);
      }
      for (const toggle of ["Has slides or materials", "My schedule only"]) {
        expect(filterPanel, toggle).toContain(`label="${toggle}"`);
        expect(md, toggle).toContain(`**${toggle}**`);
      }
      expect(filterPanel).toContain("Clear all");
      expect(md).toContain("**Clear all**");
    });

    it("tells attendees a filtered view is shareable as a URL", () => {
      expect(md).toContain("copying the URL out of the address bar shares exactly the view");
    });
  });

  describe("getting-started — the Format field", () => {
    const md = help("getting-started");

    it("lists every format label in the shared vocabulary, in order", () => {
      const labels = SESSION_FORMATS.map((f) => SESSION_FORMAT_LABELS[f]);
      expect(labels).toEqual([
        "Keynote",
        "Talk",
        "Workshop",
        "Panel",
        "Lightning talk",
        "Poster",
        "Break",
        "Social",
        "Other",
      ]);
      let cursor = 0;
      for (const label of labels) {
        const at = md.indexOf(`**${label}**`, cursor);
        expect(at, `${label} in program order`).toBeGreaterThan(-1);
        cursor = at;
      }
    });

    it("names the field and its empty default as ProgramTab renders them", () => {
      const programTab = read("components/organizer/ProgramTab.tsx");
      expect(programTab).toContain('{ value: "", label: "No format" }');
      expect(md).toContain("**Format**");
      expect(md).toContain("**No format**");
      expect(md).toContain("**Filter by format**");
    });

    it("is honest about ingest only filling in what a title states, and about CSV", () => {
      // The cues inferSessionFormat actually fires on — no invented examples.
      for (const title of ["Opening keynote", "Workshop block A", "Lunch"]) {
        expect(inferSessionFormat(title), title).not.toBeNull();
      }
      expect(inferSessionFormat("Paper session 3B")).toBeNull();
      expect(md).toContain("only when a title says so outright");
      expect(md).toContain("Paper session 3B");
      expect(md).toContain("`format` column");
      expect(SESSION_CSV_FIELDS).toContain("format");
    });
  });
});

describe("HELP-2 — help index brand tokens", () => {
  it("substitutes {{product}} in article descriptions the same way /help/[slug] does", () => {
    const outreach = listHelpArticles().find((a) => a.slug === "send-sponsor-outreach");
    expect(outreach).toBeDefined();
    expect(outreach!.description).toContain("{{product}}");
    expect(applyBrandTokens(outreach!.description)).toContain(brand.productName);
    expect(applyBrandTokens(outreach!.description)).not.toContain("{{product}}");
  });

  it("the help index page applies applyBrandTokens to descriptions", () => {
    const src = readFileSync(join(__dirname, "../pages/help/index.tsx"), "utf8");
    expect(src).toContain("applyBrandTokens");
    expect(src).toContain("description: applyBrandTokens(a.description)");
  });
});
