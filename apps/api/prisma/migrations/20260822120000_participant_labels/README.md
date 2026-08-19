# participant_labels (PART-1)

Organizer-defined participant labels, scoped per event.

## Columns (additive)

- `Event.participantLabelsJson` TEXT NULL — JSON array of label strings (≤20, each 1–40 chars, unique after trim).
- `EventMembership.participantLabel` VARCHAR(40) NULL — this member's label at this event.

`User.participantType` is **not** changed. It stops being written or shown.

## Delete decision

Removing a label from the event list **NULLs** memberships that held it. Implemented in the PUT `/event` write path (same transaction as the list update), not a trigger. Covered by the DB suite.
