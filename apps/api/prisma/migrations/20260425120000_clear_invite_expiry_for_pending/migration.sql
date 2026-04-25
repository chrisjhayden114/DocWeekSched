-- Pending profile-setup links no longer use an expiry; clear dates so tokens stay valid.
UPDATE "User"
SET "profileSetupTokenExpiresAt" = NULL
WHERE "profileSetupToken" IS NOT NULL;
