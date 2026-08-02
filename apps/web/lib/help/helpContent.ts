/**
 * Help article markdown, bundled into the server build.
 *
 * WHY: `content/help/*.md` is not traced into the serverless bundle on
 * Netlify, so runtime `fs` reads silently returned nothing and /help rendered
 * empty in production. The markdown files remain the human-editable source;
 * a test asserts this module matches them byte-for-byte (body content).
 *
 * To update an article: edit the .md file, then mirror the change here.
 */

export const HELP_SOURCE: Record<string, string> = {
  "getting-started": `---
title: Getting started
description: Create an organization, build your first event, invite attendees, and publish.
order: 1
---

# Getting started

Welcome to **{{product}}**. This guide covers the first hour for organizers.

## 1. Create an account and organization

1. Open [Sign in](/login) and create an account.
2. Create an organization when prompted — this is your billing and event workspace.

## 2. Create an event (Setup Copilot)

The fastest path is **Setup Copilot** on [New event](/organizer/events/new?mode=ai):

1. Answer a few questions (name, dates, venue).
2. Confirm the draft sessions and features.
3. Copilot checks off **Create event** and **Add sessions** on your onboarding checklist.

You can also create an event manually or start from an optional sample draft on first login.

## 3. Invite attendees

From the dashboard, use **Invite** to send links (email when configured). Inviting marks the checklist’s **Invite attendees** step.

## 4. Publish

When the agenda looks right, publish the event so \`/e/your-slug\` is public. Publishing marks **Publish** on the checklist.

## Try the public demo

Explore a read-only sample conference at [/e/demo](/e/demo) — no account required.

## Need help?

Email [{{support}}](mailto:{{support}}). Support hours: {{hours}}.
`,
  "attendee-faq": `---
title: Attendee FAQ
description: How attendees open the schedule, save sessions, and join without an app download.
order: 2
---

# Attendee FAQ

## How do I join an event?

Open the link your organizer shared — usually \`/e/event-slug\` or an invite URL. Sign in (or create an account), then use **Agenda** and **My Schedule**.

## Do I need a mobile app?

No. {{product}} works in the browser on phone and desktop.

## Where is the schedule?

After you join, open the dashboard. **Agenda** shows the full program; save sessions to build **My Schedule**.

## Can I message other attendees?

Only if your organizer enabled messaging or community features for that event. Disabled features do not appear in the navigation.

## Who do I contact for event questions?

Ask your event organizer first (they control the program and invites). For product issues, email [{{support}}](mailto:{{support}}).
`,
  contact: `---
title: Contact
description: How to reach support — email and honest support hours.
order: 3
---

# Contact

## Email

Write to [{{support}}](mailto:{{support}}).

## Support hours

{{hours}}

We do **not** promise 24/7 live human support. On event days we provide **best-effort** assistance during support hours. For platform status, see the [status page]({{status}}); for urgent incident updates, email [{{support}}](mailto:{{support}}).

## What to include

- Your organization or event name (if relevant)
- Whether the event is live today
- Steps to reproduce and screenshots when useful

A fuller help center with search and an in-app assistant is planned (Phase S1).
`,
};
