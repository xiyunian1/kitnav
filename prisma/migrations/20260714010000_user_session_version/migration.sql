-- Incrementing this value invalidates every previously issued JWT for a user.
ALTER TABLE "User"
ADD COLUMN "sessionVersion" INTEGER NOT NULL DEFAULT 0;
