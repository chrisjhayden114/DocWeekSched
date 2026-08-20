---
title: Invite participants and manage the roster
description: Invite people one at a time or from a spreadsheet, manage the roster, and define participant labels.
order: 4
---

# Invite participants and manage the roster

Everything about who's coming lives on the event's **Participants** tab: invitations, the roster, and the labels attendees can pick.

## Invite one person

1. Under **Invite one person**, enter their **Name** and **Email**.
2. Choose **Send invite**.

They get a setup email with a personal link, and a starter profile is created for them — they choose a password to finish, then land on the event. Setup links expire after 7 days by default; sending a fresh invite to the same person issues a new one.

If email delivery isn't configured for your installation, you'll get **Copy invite link** instead and can share it yourself.

## Invite a group from a spreadsheet

1. Under **CSV bulk invite**, choose your CSV file.
2. Check **Column mapping**. Headers like `email`, `name`, `description`, `bio`, and `photo_url` are detected automatically — common variants (`e-mail`, `full name`, `role`, `about`, `avatar`) are recognised too. Anything else you can map yourself, or set to **Skip**.
3. Read the dry run. Every row is checked before anything happens, and problems are listed per row: **Missing email**, **Invalid email**, **Duplicate in file**, **Already on roster**.
4. Choose **Invite N people**.

Only an email column is genuinely required — a row without a name still works. You can review up to 500 rows at a time and invite up to 200 people per upload, so split very large rosters into batches.

## Manage the roster

The **Roster** below shows everyone with their invite status:

- **Invite sent** — invited, hasn't finished setting up.
- **Active** — finished setup and can open the event.
- **Invite expired** — their setup link lapsed. Invite them again to send a fresh one.

Each row has a menu. Owners can **Make admin** or **Remove admin**; any organizer can **Remove participant**. There's no separate resend button — inviting the same email again refreshes their link.

## Removing someone, and the 30 days

Removing a participant takes them off the roster and ends their access to the event immediately. Their roster record is kept for 30 days and then permanently deleted, which means an accidental removal is recoverable: invite the same email again inside that window and they're back on the roster.

To be precise about what that promise covers: the 30 days applies to their membership of **this event**. Their user account and anything they posted are governed by our general retention terms, not by this sweep — see [Privacy](/privacy).

## Participant labels

Labels let attendees say which department, cohort, or role they belong to, in words that fit your event.

1. In **Participant labels**, type a label and choose **Add**. Add up to 20, each 1–40 characters.
2. Choose **Save labels**.

Attendees then pick one — **Your label at this event (optional)** when they join, or **Participant label** on their profile afterwards. It's one label each, and it's optional.

You can override anyone's pick from the **Label** column on the roster. Labels appear beside people in the attendee directory, for attendees who've chosen to appear there.

Removing a label from the list clears it from everyone who had picked it, so retire labels deliberately.
