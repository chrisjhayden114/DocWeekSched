# DESIGN_PHASE_E — elevating the craft without betraying "calm"

**Written 2026-08-07 as a research/strategy pass. No code. Decide the direction
in §6 before any implementation.**

The founder's instinct — "the site looks clunky and basic" — is correct. But the
references he shared (glossy AI assistants, count-up dashboards, glassmorphic chat
apps) point in a direction that, taken literally, would fight the product's entire
positioning. This document separates the part of that instinct we should act on
from the part we should refuse, and proposes how to make UKEDL feel genuinely
premium *while staying calm*.

---

## 1. The central finding: "basic" is a craft problem, not a flash problem

Look at what the admired references actually share. Strip away the neon and the
glass and three transferable things remain:

- **Depth and spatial rhythm.** Elements sit in a considered hierarchy — a clear
  foreground/background, generous and *consistent* spacing, cards that feel
  placed rather than stacked. worktail's dashboard isn't good because it's cream;
  it's good because everything is on a grid with air around it.
- **Motion that communicates.** The count-up (17.3% → 89.4%), the staggered card
  reveal, the smooth tab slide. These aren't decoration — they tell your eye
  *what changed* and *where to look*. Motion is the single biggest gap in UKEDL:
  the tokens define exactly one transition (`--transition: all 0.15s`) and no
  keyframes, no enter animations, no choreography.
- **Typographic and iconographic confidence.** Big, sure headlines. One icon
  family, consistently weighted. Numbers treated as first-class (worktail's "89.4%"
  is huge and proud).

**None of these three require betraying calm.** They are *craft*. UKEDL is missing
craft, and craft is what reads as "premium." The current UI is competent and
correct — Phase D did real work — but it is flat, still, and under-spaced. That is
fixable without a single gradient.

## 2. What in the references is flash — and would actively hurt UKEDL

The references are almost all **consumer AI apps optimised for delight and
engagement**. UKEDL is **calm software for academics** whose written positioning
(`HANDOFF_BRIEF.md` §1) explicitly rejects engagement mechanics. Copying these
literally walks straight into the anti-goals:

| Reference trait | Why it's tempting | Why it betrays UKEDL |
|---|---|---|
| Neon purple/green gradients, dark-mode drama | Looks "modern", "AI" | Academic buyers read it as consumer/toy; fights the institutional trust the product needs. UKEDL's `#0033a0` is a deliberate, serious blue. |
| Glassmorphism everywhere | Feels expensive | A11y nightmare (contrast), dates fast, and it's decoration — the exact opposite of "the neutral ramp does 90% of the work." |
| Count-up vanity metrics on every card | The video's wow moment | These are *engagement theatre*. A count-up on a dashboard number a professor checks twice is noise. (One tasteful count-up on the ingest result — "22 sessions found" — is arguably earned; see §5.) |
| Glossy 3D orbs, sparkle icons | "AI magic" | UKEDL's honesty rule: don't dress the AI as a wizard. The Assistant should feel like a competent librarian, not a genie. |
| "Try Premium!" banners, upsell tiles | Standard SaaS | Dark-pattern-adjacent; the pricing page is deliberately calm and public. |

**The trap to avoid:** chasing "make it look like the cool AI apps" would produce
a product that looks like every other 2026 AI wrapper and reads as *less*
trustworthy to a department administrator, not more. The competitive edge is that
UKEDL looks like it was made by someone who understands their world.

## 3. The direction: "quietly excellent," not "excitingly AI"

The aesthetic to aim for is closer to **Linear, Stripe's dashboard, and Things**
than to the consumer AI apps in the references — software that feels expensive
through *restraint executed flawlessly*: perfect spacing, confident type,
motion that's felt more than seen, depth used sparingly and precisely.

Keep everything Phase D got right (Inter, the gray ramp, borders-over-shadows,
scarce blue, small radii, rows-not-cards for data). **Elevate the execution:**

1. **Space.** Audit every screen against the 4px spacing scale; the Program tab's
   "text all over the place" (founder's words, and the UX audit's C3) is mostly a
   spacing-rhythm failure, not a content problem. Generous, consistent padding is
   the cheapest premium signal there is.
2. **Motion, tastefully.** Add a real motion layer to the tokens: page/section
   enter (subtle fade+rise, 200–300ms, staggered ~40ms), list-row stagger on
   load, smooth segmented-control slide, a *single* earned count-up (ingest
   result), and honest loading skeletons that pulse rather than freeze. **All
   behind `prefers-reduced-motion`** — non-negotiable for an academic/accessibility
   audience.
3. **Depth, precisely.** One more elevation step above `--shadow-2` for truly
   floating things (modals, the assistant), and a considered focus-glow. Not glass,
   not everywhere — depth as punctuation.
4. **Numbers with pride.** Where UKEDL shows a real figure (attendee counts,
   ingest results, analytics), make it typographically confident — worktail's one
   genuinely transferable move.
5. **Empty states that teach.** The single biggest "basic" tell in current UKEDL
   is bare empty states ("No messages yet"). Premium products use empty space to
   orient and delight quietly. Cheap to fix, huge perceived-quality return.
6. **Iconography pass.** Confirm one icon family at one weight across the app;
   mismatched icons read as amateur faster than almost anything.

## 4. Where the current UI specifically falls short (grounded in the code)

From `tokens.css`, `globals.css` and the audit screenshots:

- **No enter/stagger motion anywhere.** Everything pops in. This is the #1 "static
  and cheap" signal.
- **Shadow ramp stops too low** (`--shadow-2` is the ceiling); nothing feels
  genuinely elevated, so modals and the assistant sit flatly on the page.
- **Radii are very tight** (4/6/10px). Correct for dense data rows, but the
  marketing surfaces and the assistant could carry slightly softer corners to feel
  friendlier without going pill.
- **Spacing is applied but not audited** — inconsistent gaps are what create the
  "clunky" read on the Program and ingest screens.
- **Loading = skeleton bars that don't move.** A gentle shimmer changes the felt
  quality instantly.
- **Empty states are one grey sentence.** Every one is an opportunity missed.

## 5. Part 2 — the Event Assistant, specifically

The founder is right that it feels basic: today it's a white modal with three
text-button "starters" and a plain input (screenshot 2026-08-07). The admired chat
references (the "Knowledge Item / Image / File / Web Search" tool-chip menu, the
streaming answer with a source card, the follow-up suggestion chips) show what
*modern assistant UX* looks like. What actually makes those feel good, decomposed:

1. **A composer that shows its capabilities** — the `+` menu revealing what you can
   attach/do. UKEDL's equivalent isn't files; it's **scopes**: "this session",
   "this morning", "by room", "find a person". Surfacing those as chips teaches the
   user what to ask.
2. **Streaming responses**, not a spinner then a wall of text. Token-by-token
   arrival is most of the "alive" feeling, and UKEDL's gateway can stream.
3. **Grounded source chips.** When the assistant says "Room 214 at 10:30," it
   shows the session it read that from, as a tappable chip. This is *on-brand* —
   it's the honesty rule made visible, and no consumer reference does it as well as
   an academic tool could.
4. **Follow-up suggestion chips** after each answer ("add this to my schedule",
   "what's after it?") — momentum without pestering.
5. **Answer formatting** — a session result rendered as a proper card (title,
   time, room, add-to-schedule), not a paragraph.

**What to refuse, even here:** the glowing orb, the "AI is thinking ✨" mysticism,
the personality cosplay ("Hi! I'm your event genie!"). The Assistant's whole value
is that it's *grounded and trustworthy* — it should look like it's reading the
programme, because it is. Calm, competent, sourced.

The E19 work already renamed it the **Event assistant** and fixed the mislabel;
this is about elevating how it *feels* and how much it can visibly do — a bigger,
right-anchored panel (not a cramped centre modal), streaming, source chips,
scope + follow-up chips, and card-formatted answers.

## 6. DECISION POINT — pick the direction before any code

**Option A — "Quietly excellent" (recommended).** Keep the Phase D design
language; add a craft layer: motion tokens + reduced-motion, one higher elevation
step, spacing audit, live empty states, loading shimmer, confident numbers, icon
consistency, and the Assistant elevation in §5. Result: UKEDL feels like Linear/
Stripe-grade software — premium through restraint, fully on-brand, accessible.
Ships as small reviewable chunks (E28+). Low risk to the positioning.

**Option B — "Warmer / more expressive."** A also, plus a genuine visual identity
move: a signature background texture (the topographic lines in worktail, done
subtly), a slightly richer surface palette, more generous radii on marketing.
Still calm, but with more personality. Medium effort, small brand risk — worth it
if you feel UKEDL currently reads as *sterile* rather than *calm*.

**Option C — "Chase the references."** Gradients, glass, dark-mode-first, count-ups
everywhere, glossy assistant. **Not recommended, and I'd argue against it** — it
betrays the anti-goals, dates fast, and makes an academic tool look like a
consumer toy. Named here only so the trade-off is explicit.

## 7. If A or B: proposed phase order (each a small chunk, screenshot review)

- **E28 — motion foundation.** Motion tokens (durations, eases), `prefers-
  reduced-motion` guard, page/section enter, list-row stagger, segmented-control
  slide. One layer, visible everywhere, low blast radius.
- **E29 — depth + spacing audit.** New elevation step, focus-glow, and a
  screen-by-screen spacing pass starting with the Program and ingest screens
  (the named offenders).
- **E30 — states.** Loading shimmer; rewrite every empty state to orient +
  quietly delight; confident number treatment.
- **E31 — Event assistant elevation.** Right-anchored panel, streaming, source
  chips, scope + follow-up chips, card-formatted session answers. (Behavioural +
  visual; coordinate with the Setup/Event assistant work from E19 and the
  concierge grounding in `lib/ai`.)
- **E32 — marketing polish.** Softer radii + optional subtle texture on `/`,
  `/pricing`, `/compare/*`; device-framed real-product screenshots per Phase D
  Part 1 point 9 (the marketing pages currently have none).

## 8. Non-negotiables for whatever we build

- Every animation respects `prefers-reduced-motion`.
- No contrast regressions (the UX audit measured current text at ~5.2:1+; keep it).
- Design values stay in the token layer — no hardcoded hex/px in components.
- Nothing here touches schema, API, or auth. Pure presentation + the assistant's
  response *rendering* (its grounding logic is unchanged).
- The anti-goals hold: no engagement theatre, no dark patterns, no manufactured
  urgency.
EOF
echo "written $(wc -l < DESIGN_PHASE_E.md) lines"