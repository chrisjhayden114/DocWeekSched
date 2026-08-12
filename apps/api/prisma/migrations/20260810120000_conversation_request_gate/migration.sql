-- M4a: request-gate columns, additive and inert. status defaults ACTIVE so every
-- existing conversation is unaffected; nothing reads these until M4b.
ALTER TABLE "Conversation" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'ACTIVE';
ALTER TABLE "Conversation" ADD COLUMN "initiatedById" TEXT;
