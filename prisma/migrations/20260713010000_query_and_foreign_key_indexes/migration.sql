-- Existing production databases prepare these indexes concurrently before migrate deploy.
-- IF NOT EXISTS keeps this migration non-blocking there while still initializing empty databases.
CREATE INDEX IF NOT EXISTS "User_createdAt_idx"
ON "User"("createdAt");

CREATE INDEX IF NOT EXISTS "Account_userId_idx"
ON "Account"("userId");

CREATE INDEX IF NOT EXISTS "Session_userId_idx"
ON "Session"("userId");

CREATE INDEX IF NOT EXISTS "Generation_module_createdAt_idx"
ON "Generation"("module", "createdAt");

DROP INDEX IF EXISTS "Generation_module_idx";

CREATE INDEX IF NOT EXISTS "CreditTransaction_type_createdAt_idx"
ON "CreditTransaction"("type", "createdAt");

CREATE INDEX IF NOT EXISTS "Order_createdAt_idx"
ON "Order"("createdAt");

CREATE INDEX IF NOT EXISTS "Order_status_paidAt_idx"
ON "Order"("status", "paidAt");

CREATE INDEX IF NOT EXISTS "AdminAuditLog_createdAt_idx"
ON "AdminAuditLog"("createdAt");

CREATE INDEX IF NOT EXISTS "RegistrationEvent_userId_createdAt_idx"
ON "RegistrationEvent"("userId", "createdAt");

CREATE INDEX IF NOT EXISTS "Feedback_createdAt_idx"
ON "Feedback"("createdAt");

CREATE INDEX IF NOT EXISTS "ImageTurn_status_createdAt_idx"
ON "ImageTurn"("status", "createdAt");

CREATE INDEX IF NOT EXISTS "Material_visibility_status_updatedAt_idx"
ON "Material"("visibility", "status", "updatedAt");

CREATE INDEX IF NOT EXISTS "MaterialReport_reporterId_idx"
ON "MaterialReport"("reporterId");

DROP INDEX IF EXISTS "PptSlide_projectId_order_idx";
