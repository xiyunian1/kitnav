-- Replace the list index with a stable keyset-pagination index.
CREATE INDEX IF NOT EXISTS "ImageConversation_userId_updatedAt_id_idx"
ON "ImageConversation"("userId", "updatedAt", "id");

DROP INDEX IF EXISTS "ImageConversation_userId_updatedAt_idx";
