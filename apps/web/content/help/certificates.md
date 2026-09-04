---
title: Issue certificates after the event
description: Use our built-in layout or upload your own finished design, set an eligibility rule, batch-issue with progress, and let anyone confirm a certificate on the public verify page.
order: 12
category: organizer
---

# Issue certificates after the event

Certificates are a download you issue after the event ends — not a live editor attendees fill in. You define a template and a rule for who is eligible, then batch-issue. A template either uses our built-in layout or wraps a design you upload yourself. Eligible people get an email with a **link**, not a PDF attachment. Anyone can confirm a certificate on the public verify page.

Certificates are included on Per-event plans and above. The **PD day / Training** and **Academic program** presets leave them on; **Focused** turns them off.

## Templates

On the **Certificates** tab of your event, create a template: a name for your own reference, who is eligible, optional hours — and one of two designs.

**The built-in layout** needs no design work. You give it the title text, optional body text, and an optional signature image, and issued PDFs use this event's **accent color** and **logo**. If neither is set, the certificate uses the platform layout — see [Brand your event](/help/event-branding).

**Your own design** is described in the next section.

## Use your own design

Most organizers already have a certificate: they made it in Canva, or a colleague did, and it is finished. You can upload that file instead of using our layout, and we place each attendee's name on it.

Switch **Design** to *Your own design*, pick landscape or portrait, and upload the PNG or JPG. A preview appears immediately with a sample name on it, and three controls change how that name is drawn:

- **Name position** — a slider that moves the name up and down. The name is always centered left-to-right; there is no draggable box in this version.
- **Name size** — a stepper, in points.
- **Name color** — dark or light, for pale and dark designs respectively.

What you see in the preview is what renders: the preview and the PDF share the same placement code, so they cannot drift apart.

Practical limits, stated plainly:

- **Export at about 2000px wide**, in the same shape as the page you chose (landscape is 11 × 8.5in, portrait 8.5 × 11in). A file up to 10MB is accepted. A design in a different shape is scaled to *cover* the page, so its edges may be cropped.
- **The attendee's name is the only thing we overlay.** The event name, dates, hours and signatures need to be part of the design itself — that is where you already control exactly how they look. Hours you enter on the template are still recorded and still show on the verify page.
- **PNG and JPG only.** We upload your file as-is rather than re-compressing it, so crisp type and logos stay crisp.
- If an uploaded design is ever unreadable, the certificate falls back to the built-in layout rather than issuing a blank page.

The built-in layout remains the no-design-needed path, and switching between the two kinds never affects eligibility, issuing, the ready email, or the verify page.

## Eligibility — one rule per template

A template has one rule. Session rules count **joins** (the person registered for the session), not a staff scan at the door:

- **Any check-in** — they were checked in at the event.
- **Minimum sessions** — they joined at least N sessions.
- **Required sessions** — they joined every session on a list you pick.

That distinction matters for a PD day with a door scan: someone can be eligible on a session rule without ever being scanned, and someone scanned at the door can fail a session rule if they never joined.

## Batch issue, with progress

Batch issue runs in the background, and it works the same way for both kinds of design. You start it from Recap; progress updates as certificates are generated. Re-issuing the same person on the same template keeps their original issue date and public id.

The ready email carries a link to the public verify page (and a note that they can also download from their event profile). It does not attach the PDF.

## Public verify

Anyone with the certificate id can open `/verify/<id>` and see whether it matches a certificate we can confirm — name, event, date, optional hours. No account is required.

A certificate on the built-in layout prints that address on the page itself — a **Verify at** line under the certificate id — so the credential carries its proof wherever it is forwarded or printed. On your own design the name is still the only thing we overlay, so put a verify line in the artwork if you want one on the page.

## Honest limits

- There is no separate attendee Certificates tab. Eligible people download via the link or their profile after the event.
- Turning the feature off blocks new downloads. Certificates you already issued stay, and the verify page still works.
- Generate on Recap is blocked until the event has ended.
