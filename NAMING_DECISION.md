# Naming decision — vetting pass, 2026-08-02

> **DECISION (2026-08-02): Siap.** Chris chose Siap with primary domain
> **siap.events** (verified AVAILABLE against the Identity Digital registry,
> calibrated via nic.events) plus **siaphq.com** as backup/redirect. Tagline
> working draft: "Siap — your event, ready." (to be explored further).
> **PURCHASED 2026-08-02** at Porkbun: siap.events ($9.78 yr1, renews ~$36.56) and
> siaphq.com ($11.08/yr) — WHOIS privacy on, domain lock on, auto-renew on, registered
> to cjhayden114@gmail.com. Remaining gates before the public flip: attorney knockout
> search (US classes 9/42), then the one-line productName change in packages/config.
> The slug `colloquium-internal` never changes. Free Porkbun email forwarding
> (support@siap.events → Gmail) to be set up at flip time; sending stays on Resend.

Method: every candidate checked against the Verisign .com registry (RDAP, authoritative);
finalists screened for industry/trademark conflicts via web search. **This is a screening
pass, not legal advice — the finalist still goes to the attorney before committing.**

## The one finding that matters

**"Colloquium" is already the name of a 60-year-old conference company in exactly this
industry.** Colloquium (colloquium-group.com, Paris) is one of France's historic
professional conference organizers — it has run congresses for scientific and medical
societies since 1953. That is UKEDL's *precise* customer base (academic/scientific
conferences), which makes this the worst kind of name neighbor: same industry, long
prior use, and the exact confusion a trademark examiner or opposing counsel looks for.
US registration might still be arguable; European expansion would be walled off; and
some academic customers (medical societies especially) will already know the name.
This is very likely what the attorney clearance would surface anyway.

## Domain reality check (.com registry, checked 2026-08-02)

| Domain | Status |
|---|---|
| siap.com, getsiap.com | taken |
| **siaphq.com** | **AVAILABLE** |
| colloquium.com, colloquy.com | taken |
| **getcolloquium.com, colloquiumhq.com** | **AVAILABLE** |
| eventhelm.com, eventnav.com, eventcaptain.com | taken (parked) |
| eventready.com, simpleevent.com, turnout.com, assemble.com | taken |
| showready.com, confero.com, adsum.com, convena.com, paratus.com, nakhoda.com, kemudi.com | taken |

Pattern: every bare dictionary word and clean compound is registered (mostly squatted).
The realistic paths are a prefix/suffix domain (getX / Xhq) or a coined word.

## Ranking

### 1. Siap — most ownable
Short, distinctive, real meaning ("ready" in Indonesian/Malay — on-message for a product
whose next act is Event Readiness). No conflicting software company found (only
Siap+Micros, an Italian weather-instruments firm — unrelated industry). As a
non-descriptive foreign word it is a strong, registrable mark. Domain `siaphq.com`
available now; `siap.com` could be pursued from its holder later from a position of
strength.
**Risks:** opaque to English speakers on first contact (pronunciation "SEE-ahp";
may read as an acronym). Needs a tagline doing the semantic work — e.g.
"Siap — your event, ready." Mitigable; distinctiveness is the price of ownability.

### 2. Colloquium — best meaning, now materially riskier
Perfect semantic fit for academic conferences, and both `getcolloquium.com` and
`colloquiumhq.com` are available. But the French PCO finding above is a genuine
industry conflict, and as a common dictionary word in its own field it would be a
weak mark even without the conflict — hard to register, hard to enforce. Keep on the
attorney's desk only if Siap fails some test; do not buy domains yet.

### 3. Eliminated
- **Descriptive family** (Ready, Event Ready, Simple Event, Your Event Planner,
  Event Navigator/Captain/Helm, EventNav, Turnout, Assemble): legally unownable as
  marks, all exact .coms taken, and they read as features, not brands.
- **Copilot family** (Event Copilot, etc.): crowded space, Microsoft's aggressive
  "Copilot" trademark posture, and dates the product to a 2023–24 naming fad.

## If Siap is chosen — the actual work

1. Attorney: knockout search on "Siap" for US classes 9/42 (software/SaaS).
2. Buy `siaphq.com` (~$10) immediately; optionally `siap.io` / `siap.events`.
3. One line in `packages/config`: productName → "Siap" (slug `colloquium-internal`
   must NOT change).
4. Dashboard renames (10 min total): Sentry org, Resend nothing (domain-based),
   Render service name optional, Netlify site name optional.
5. Keep ukedl.com serving 301 redirects indefinitely; mail.ukedl.com keeps sending
   until a new sending domain is verified — no email interruption.

Decision owner: Chris. Nothing blocks launch work while this sits — the name is one
config line whenever it lands.
