# Phase 6 Chunk C — Onboarding flags

**DO NOT APPLY until founder reviews this SQL.**

Adds nullable timestamps on `User`:
- `onboardingDismissedAt` — checklist panel dismissed (persist across sessions)
- `sampleEventOfferedAt` — sample-event prompt offered/accepted (do not re-offer)

Checklist steps stay on `EventSeries.setupChecklist` JSON.
