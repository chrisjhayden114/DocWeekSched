---
title: Invite participants and manage the roster
description: Invite people one at a time or from a spreadsheet, manage the roster, and define participant labels.
order: 4
category: organizer
---

# Invite participants and manage the roster

Build the roster weeks early and invite on your schedule — adding people and emailing them are separate steps, so nobody gets a premature invite.

Everything about who's coming lives on the event's **Participants** tab: invitations, the roster, and the labels attendees can pick.

## Invite one person

1. Under **Invite one person**, enter their **Name** and **Email**.
2. Choose **Send invite**.

They get a setup email with a personal link, and a starter profile is created for them — they choose a password to finish, then land on the event. Setup links expire after 7 days by default; sending a fresh invite to the same person issues a new one.

If email delivery isn't configured for your installation, you'll get **Copy invite link** instead and can share it yourself.

## Add a group from a spreadsheet

Importing a spreadsheet does **not** email anyone until you say so. You see the whole list first, choose who's included, and then pick one of two actions.

1. Under **Add participants from a spreadsheet**, choose your CSV file.
2. Check **Column mapping**. Headers like `email`, `name`, `description`, `bio`, and `photo_url` are detected automatically — common variants (`e-mail`, `full name`, `role`, `about`, `avatar`) are recognized too. A `label` column is picked up when your event defines participant labels. Anything else you can map yourself, or set to **Skip**.
3. Read the review. Every row is checked before anything happens, and problems are listed per row: **Missing email**, **Invalid email**, **Duplicate in file**, **Already on roster**, and any label your event doesn't define.
4. Untick anyone you don't want (**Select all** / **Select none** does the whole list), and set each person's label from the **Label** dropdown if you use labels.
5. Choose either:
   - **Add N to the roster** — creates everyone's place at the event and sends nothing. They show as **Not invited** until you invite them.
   - **Add and send N invites** — does the same, then emails each person their setup link.

Either way you get a summary that says exactly what happened, including anyone who was skipped and any invite that couldn't be sent.

Only an email column is genuinely required — a row without a name still works. You can review up to 500 rows at a time and add up to 200 people per upload, so split very large rosters into batches.

## Send invites later

Because adding people and inviting them are separate steps, you can build the roster weeks early and invite when you're ready — all at once or a few people at a time.

1. On the **Roster**, tick the people you want to invite (the box in the header ticks everyone shown).
2. Choose **Send invites**.

Each person gets an email that names your event, asks them to choose a password, and carries their check-in code. Anyone who has already finished setting up is reported instead of emailed, and any invite that fails is listed individually — the summary never claims an email that didn't go out. If email delivery isn't configured, each invite link is shown for you to copy and share.

## Manage the roster

The **Roster** below shows everyone with their invite status, and — when you use them — a **Label** column and a **Payment** column:

- **Not invited** — on the roster (usually from a spreadsheet), never emailed. Tick them and choose **Send invites** whenever you're ready.
- **Invite sent** — invited, hasn't finished setting up.
- **Active** — finished setup and can open the event.
- **Invite expired** — their setup link lapsed. Send invites again for a fresh one.

Each row has a menu. Owners can **Make admin** or **Remove admin**; any organizer can **Remove participant**. There's no separate resend button — sending invites again (or inviting the same email again) refreshes their link.

When **Registration fees** is on, the **Payment** column records unpaid, PO on file, paid, waived, or refunded, plus an optional PO / check reference. See [Track registration fees](/help/registration-fees). When the event defines participant labels, the **Label** column lets you set each person's label from the roster.

## Removing someone, and the 30 days

Removing a participant takes them off the roster and ends their access to the event immediately. Their roster record is kept for 30 days and then permanently deleted, which means an accidental removal is recoverable: invite the same email again inside that window and they're back on the roster.

To be precise about what that promise covers: the 30 days applies to their membership of **this event**. Their user account and anything they posted are governed by our general retention terms, not by this sweep — see [Privacy](/privacy).

## Participant labels

Labels let attendees say which department, cohort, or role they belong to, in words that fit your event.

1. In **Participant labels**, type a label and choose **Add**. Add up to 20, each 1–40 characters.
2. Choose **Save labels**.

Attendees then pick one — **Your label at this event (optional)** when they join, or **Participant label** on their profile afterwards. It's one label each, and it's optional.

You can also set labels yourself: per row while reviewing a spreadsheet import, or from the **Label** column on the roster afterwards. Labels appear beside people in the attendee directory, for attendees who've chosen to appear there.

Removing a label from the list clears it from everyone who had picked it, so retire labels deliberately.
