-- CHAT-2 (B3): organizer-configurable Event assistant starter questions.
-- JSON-encoded string[] (max 3 items x 80 chars, validated in the API);
-- NULL means "use the built-in defaults". Additive only.
ALTER TABLE "Event" ADD COLUMN "assistantStartersJson" TEXT;
