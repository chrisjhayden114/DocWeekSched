---
title: Check attendees in with a QR code
description: Each attendee has a personal QR on their profile. Staff scan it, type the code, or queue scans offline and sync when the connection returns.
order: 13
category: organizer
---

# Check attendees in with a QR code

**QR check-in** gives each attendee a personal code on their membership. Staff scan it at the door, or type the same code by hand. A person can be checked in once per event; a second read of the same code is ignored.

Check-in is included on Per-event plans and above. Turn it on from the event's **Features** tab if it is off.

## Where the attendee QR lives

Each attendee's check-in QR sits at the top of **Profile**, labelled **Event check-in QR**. It encodes that person's per-event check-in code — the same value you can type or paste on the scanner. Invite emails also carry the code.

## The scanner page

Open **Check-in** from the organizer console (`/organizer/events/<id>/scanner`). Staff need organizer access.

1. Open the page on a phone with a camera.
2. Point the camera at the attendee's QR.
3. A flash confirms **Checked in** (or that they were not).

The status bar shows online/offline, how many of the roster are checked in, and how many scans are queued.

## Manual entry

If the camera is blocked, or this browser cannot detect QR codes, type or paste the code in the field on the same page. It is the same payload as the QR.

## Offline queue and sync

Scanning works offline. The device queues scans and syncs them when it is back online. The same code is ignored for a few seconds so a second read of the same QR does not double-submit.

## Browser support

The live camera uses the browser's **Barcode Detector** API. Chrome and Edge on a phone usually have it. Safari and Firefox often do not — the page then shows **Scanning isn't supported in this browser — use manual entry**, and the typed-code field is the path.

## Honest limits

- Turning check-in off hides the Profile QR and the scanner. Existing check-in records stay.
- Repeats are idempotent: checking someone in twice does not create a second record.
