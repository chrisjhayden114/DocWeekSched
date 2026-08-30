---
title: Issue certificates after the event
description: Define a template, set an eligibility rule, batch-issue with progress, and let anyone confirm a certificate on the public verify page.
order: 12
category: organizer
---

# Issue certificates after the event

Certificates are a download you issue after the event ends — not a live editor attendees fill in. You define a template and a rule for who is eligible, then batch-issue. Eligible people get an email with a **link**, not a PDF attachment. Anyone can confirm a certificate on the public verify page.

Certificates are included on Per-event plans and above. The **PD day / Training** and **Academic program** presets leave them on; **Focused** turns them off.

## Templates

On **Recap**, after the event end date, create a template: a name, the title text on the certificate, optional body text, optional hours, and an optional signature image.

Issued PDFs use this event's **accent colour** and **logo**. If neither is set, the certificate uses the platform layout — see [Brand your event](/help/event-branding).

## Eligibility — registration, not the door

A template has one rule. Session rules count **joins** (the person registered for the session), not a staff scan at the door:

- **Any check-in** — they were checked in at the event.
- **Minimum sessions** — they joined at least N sessions.
- **Required sessions** — they joined every session on a list you pick.

That distinction matters for a PD day with a door scan: someone can be eligible on a session rule without ever being scanned, and someone scanned at the door can fail a session rule if they never joined.

## Batch issue, with progress

Batch issue runs in the background. You start it from Recap; progress updates as certificates are generated. Re-issuing the same person on the same template keeps their original issue date and public id.

The ready email carries a link to the public verify page (and a note that they can also download from their event profile). It does not attach the PDF.

## Public verify

Anyone with the certificate id can open `/verify/<id>` and see whether it matches a certificate we can confirm — name, event, date, optional hours. No account is required.

## Honest limits

- There is no separate attendee Certificates tab. Eligible people download via the link or their profile after the event.
- Turning the feature off blocks new downloads. Certificates you already issued stay, and the verify page still works.
- Generate on Recap is blocked until the event has ended.
