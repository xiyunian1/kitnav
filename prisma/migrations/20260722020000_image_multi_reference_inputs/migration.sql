-- Store ordered image-edit inputs while retaining the legacy first-image
-- columns for queued jobs created by older application versions.
ALTER TABLE "ImageTurn"
ADD COLUMN "editInputs" TEXT;
