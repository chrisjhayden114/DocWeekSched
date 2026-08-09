-- Q&A question audience: EVERYONE (default) or PRESENTERS
ALTER TABLE "SessionDiscussionThread" ADD COLUMN "audience" TEXT NOT NULL DEFAULT 'EVERYONE';
