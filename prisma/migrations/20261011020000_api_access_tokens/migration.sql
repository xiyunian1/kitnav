-- Personal access tokens for external clients such as the MCP endpoint.
-- Only the SHA-256 digest is stored; the plaintext is shown once on creation.
CREATE TABLE "ApiAccessToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "tokenPrefix" TEXT NOT NULL,
    "lastUsedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApiAccessToken_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ApiAccessToken_tokenHash_key" ON "ApiAccessToken"("tokenHash");
CREATE INDEX "ApiAccessToken_userId_createdAt_idx" ON "ApiAccessToken"("userId", "createdAt");

ALTER TABLE "ApiAccessToken"
ADD CONSTRAINT "ApiAccessToken_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
