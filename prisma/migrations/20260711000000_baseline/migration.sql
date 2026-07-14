-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('USER', 'ADMIN');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'BANNED');

-- CreateEnum
CREATE TYPE "ModuleType" AS ENUM ('IMAGE', 'VIDEO', 'PROMPT_OPTIMIZER', 'PPT');

-- CreateEnum
CREATE TYPE "GenerationStatus" AS ENUM ('PENDING', 'SUCCESS', 'FAILED');

-- CreateEnum
CREATE TYPE "CreditTxType" AS ENUM ('SIGNUP_BONUS', 'CONSUME', 'RECHARGE', 'ADMIN_ADJUST', 'REFUND');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('PENDING', 'PAID', 'FAILED', 'REFUNDED', 'CANCELED');

-- CreateEnum
CREATE TYPE "FeedbackType" AS ENUM ('FEATURE', 'BUG', 'EXPERIENCE', 'BILLING', 'OTHER');

-- CreateEnum
CREATE TYPE "FeedbackModule" AS ENUM ('IMAGE', 'MATERIALS', 'CREDITS', 'AUTH', 'PROFILE', 'OTHER');

-- CreateEnum
CREATE TYPE "FeedbackStatus" AS ENUM ('NEW', 'IN_PROGRESS', 'RESOLVED', 'CLOSED');

-- CreateEnum
CREATE TYPE "MaterialType" AS ENUM ('IMAGE', 'VIDEO', 'AUDIO', 'DOCUMENT', 'PROMPT');

-- CreateEnum
CREATE TYPE "MaterialOwnerType" AS ENUM ('USER', 'PLATFORM');

-- CreateEnum
CREATE TYPE "MaterialSource" AS ENUM ('UPLOAD', 'GENERATION', 'REFERENCE', 'PLATFORM');

-- CreateEnum
CREATE TYPE "MaterialVisibility" AS ENUM ('PRIVATE', 'PUBLIC');

-- CreateEnum
CREATE TYPE "MaterialStatus" AS ENUM ('DRAFT', 'PENDING_REVIEW', 'APPROVED', 'REJECTED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "MaterialReportStatus" AS ENUM ('OPEN', 'RESOLVED', 'DISMISSED');

-- CreateEnum
CREATE TYPE "PptProjectStatus" AS ENUM ('DRAFT', 'PENDING', 'QUEUED', 'GENERATING', 'STRATEGIZING', 'ACQUIRING_IMAGES', 'EXECUTING', 'EXPORTING', 'READY', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "PptSourceType" AS ENUM ('TOPIC', 'DOCUMENT', 'URL', 'MARKDOWN');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "emailVerified" TIMESTAMP(3),
    "name" TEXT,
    "image" TEXT,
    "passwordHash" TEXT,
    "role" "Role" NOT NULL DEFAULT 'USER',
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "credits" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Account" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerAccountId" TEXT NOT NULL,
    "refresh_token" TEXT,
    "access_token" TEXT,
    "expires_at" INTEGER,
    "token_type" TEXT,
    "scope" TEXT,
    "id_token" TEXT,
    "session_state" TEXT,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "sessionToken" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VerificationToken" (
    "identifier" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL
);

-- CreateTable
CREATE TABLE "Generation" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "module" "ModuleType" NOT NULL,
    "prompt" TEXT NOT NULL,
    "params" TEXT,
    "status" "GenerationStatus" NOT NULL DEFAULT 'PENDING',
    "resultUrl" TEXT,
    "creditsCost" INTEGER NOT NULL DEFAULT 0,
    "usedOwnKey" BOOLEAN NOT NULL DEFAULT false,
    "error" TEXT,
    "providerSource" TEXT,
    "providerModel" TEXT,
    "upstreamStatus" INTEGER,
    "durationMs" INTEGER,
    "imageCount" INTEGER NOT NULL DEFAULT 1,
    "successCount" INTEGER NOT NULL DEFAULT 0,
    "failedCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Generation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreditTransaction" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "type" "CreditTxType" NOT NULL,
    "balanceAfter" INTEGER NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CreditTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Order" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "credits" INTEGER NOT NULL,
    "amount" INTEGER NOT NULL,
    "status" "OrderStatus" NOT NULL DEFAULT 'PENDING',
    "provider" TEXT NOT NULL DEFAULT 'mock',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "paidAt" TIMESTAMP(3),

    CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RechargePackage" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "credits" INTEGER NOT NULL,
    "amount" INTEGER NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "popular" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RechargePackage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Setting" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Setting_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "AdminAuditLog" (
    "id" TEXT NOT NULL,
    "adminId" TEXT,
    "action" TEXT NOT NULL,
    "target" TEXT,
    "detail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdminAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InviteCode" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "maxUses" INTEGER NOT NULL DEFAULT 1,
    "usedCount" INTEGER NOT NULL DEFAULT 0,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "note" TEXT,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InviteCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RegistrationEvent" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "email" TEXT,
    "provider" TEXT NOT NULL,
    "ip" TEXT,
    "inviteCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RegistrationEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserDailyActivity" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "day" TEXT NOT NULL,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserDailyActivity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SiteAnnouncement" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "placement" TEXT NOT NULL DEFAULT 'APP',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SiteAnnouncement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Feedback" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "FeedbackType" NOT NULL,
    "module" "FeedbackModule" NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "screenshotUrls" TEXT,
    "pagePath" TEXT,
    "status" "FeedbackStatus" NOT NULL DEFAULT 'NEW',
    "adminNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Feedback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProviderConfig" (
    "id" TEXT NOT NULL,
    "module" "ModuleType" NOT NULL,
    "baseUrl" TEXT NOT NULL,
    "apiKey" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "models" TEXT,
    "modelMeta" TEXT,
    "modelOptions" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProviderConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserApiConfig" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "module" "ModuleType" NOT NULL,
    "baseUrl" TEXT NOT NULL,
    "apiKey" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "models" TEXT,
    "modelOptions" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserApiConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImageConversation" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL DEFAULT '新会话',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ImageConversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImageTurn" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "prompt" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "ratio" TEXT NOT NULL,
    "pixelSize" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 1,
    "status" "GenerationStatus" NOT NULL DEFAULT 'PENDING',
    "images" TEXT,
    "referenceThumbs" TEXT,
    "error" TEXT,
    "creditsCost" INTEGER NOT NULL DEFAULT 0,
    "usedOwnKey" BOOLEAN NOT NULL DEFAULT false,
    "providerSource" TEXT,
    "upstreamStatus" INTEGER,
    "durationMs" INTEGER,
    "generationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ImageTurn_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Material" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT,
    "ownerType" "MaterialOwnerType" NOT NULL DEFAULT 'USER',
    "type" "MaterialType" NOT NULL DEFAULT 'IMAGE',
    "source" "MaterialSource" NOT NULL DEFAULT 'UPLOAD',
    "visibility" "MaterialVisibility" NOT NULL DEFAULT 'PRIVATE',
    "status" "MaterialStatus" NOT NULL DEFAULT 'DRAFT',
    "title" TEXT NOT NULL,
    "description" TEXT,
    "tags" TEXT,
    "url" TEXT NOT NULL,
    "storageKey" TEXT,
    "thumbnailUrl" TEXT,
    "promptText" TEXT,
    "promptMeta" TEXT,
    "rejectionReason" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "mimeType" TEXT,
    "sizeBytes" INTEGER,
    "width" INTEGER,
    "height" INTEGER,
    "durationSec" INTEGER,
    "sourceGenerationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Material_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MaterialReport" (
    "id" TEXT NOT NULL,
    "materialId" TEXT NOT NULL,
    "reporterId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "MaterialReportStatus" NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "MaterialReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MaterialFavorite" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "materialId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MaterialFavorite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MaterialLike" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "materialId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MaterialLike_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PptProject" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "topic" TEXT,
    "audience" TEXT,
    "sourceText" TEXT,
    "tone" TEXT,
    "language" TEXT,
    "model" TEXT,
    "outline" TEXT,
    "theme" TEXT,
    "generationId" TEXT,
    "sourceType" "PptSourceType" NOT NULL DEFAULT 'TOPIC',
    "sourceTopic" TEXT,
    "sourceFileUrl" TEXT,
    "sourceUrl" TEXT,
    "sourceMarkdown" TEXT,
    "status" "PptProjectStatus" NOT NULL DEFAULT 'PENDING',
    "currentPhase" TEXT,
    "progress" INTEGER NOT NULL DEFAULT 0,
    "queuePosition" INTEGER,
    "template" TEXT,
    "slideCount" INTEGER,
    "aspectRatio" TEXT NOT NULL DEFAULT '16:9',
    "style" TEXT,
    "params" TEXT,
    "projectPath" TEXT,
    "specPath" TEXT,
    "specLockPath" TEXT,
    "svgOutputPath" TEXT,
    "pptxPath" TEXT,
    "logs" TEXT,
    "error" TEXT,
    "creditsCost" INTEGER NOT NULL DEFAULT 0,
    "usedOwnKey" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "PptProject_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PptSlide" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "subtitle" TEXT,
    "layout" TEXT NOT NULL DEFAULT 'CONTENT',
    "bullets" TEXT,
    "speakerNotes" TEXT,
    "visualPrompt" TEXT,
    "accent" TEXT,
    "imageUrl" TEXT,
    "imageStorageKey" TEXT,
    "imagePrompt" TEXT,
    "imageModel" TEXT,
    "imageStatus" "GenerationStatus",
    "imageError" TEXT,
    "imageDurationMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PptSlide_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Account_provider_providerAccountId_key" ON "Account"("provider", "providerAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "Session_sessionToken_key" ON "Session"("sessionToken");

-- CreateIndex
CREATE UNIQUE INDEX "VerificationToken_token_key" ON "VerificationToken"("token");

-- CreateIndex
CREATE UNIQUE INDEX "VerificationToken_identifier_token_key" ON "VerificationToken"("identifier", "token");

-- CreateIndex
CREATE INDEX "Generation_userId_createdAt_idx" ON "Generation"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "Generation_module_idx" ON "Generation"("module");

-- CreateIndex
CREATE INDEX "Generation_status_createdAt_idx" ON "Generation"("status", "createdAt");

-- CreateIndex
CREATE INDEX "CreditTransaction_userId_createdAt_idx" ON "CreditTransaction"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "Order_userId_createdAt_idx" ON "Order"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "RechargePackage_code_key" ON "RechargePackage"("code");

-- CreateIndex
CREATE INDEX "AdminAuditLog_adminId_createdAt_idx" ON "AdminAuditLog"("adminId", "createdAt");

-- CreateIndex
CREATE INDEX "AdminAuditLog_action_createdAt_idx" ON "AdminAuditLog"("action", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "InviteCode_code_key" ON "InviteCode"("code");

-- CreateIndex
CREATE INDEX "RegistrationEvent_ip_createdAt_idx" ON "RegistrationEvent"("ip", "createdAt");

-- CreateIndex
CREATE INDEX "RegistrationEvent_provider_createdAt_idx" ON "RegistrationEvent"("provider", "createdAt");

-- CreateIndex
CREATE INDEX "UserDailyActivity_day_idx" ON "UserDailyActivity"("day");

-- CreateIndex
CREATE INDEX "UserDailyActivity_userId_lastSeenAt_idx" ON "UserDailyActivity"("userId", "lastSeenAt");

-- CreateIndex
CREATE UNIQUE INDEX "UserDailyActivity_userId_day_key" ON "UserDailyActivity"("userId", "day");

-- CreateIndex
CREATE INDEX "SiteAnnouncement_enabled_placement_updatedAt_idx" ON "SiteAnnouncement"("enabled", "placement", "updatedAt");

-- CreateIndex
CREATE INDEX "Feedback_status_createdAt_idx" ON "Feedback"("status", "createdAt");

-- CreateIndex
CREATE INDEX "Feedback_userId_createdAt_idx" ON "Feedback"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "Feedback_type_createdAt_idx" ON "Feedback"("type", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ProviderConfig_module_key" ON "ProviderConfig"("module");

-- CreateIndex
CREATE UNIQUE INDEX "UserApiConfig_userId_module_key" ON "UserApiConfig"("userId", "module");

-- CreateIndex
CREATE INDEX "ImageConversation_userId_updatedAt_idx" ON "ImageConversation"("userId", "updatedAt");

-- CreateIndex
CREATE INDEX "ImageTurn_conversationId_createdAt_idx" ON "ImageTurn"("conversationId", "createdAt");

-- CreateIndex
CREATE INDEX "Material_ownerId_createdAt_idx" ON "Material"("ownerId", "createdAt");

-- CreateIndex
CREATE INDEX "Material_type_visibility_status_createdAt_idx" ON "Material"("type", "visibility", "status", "createdAt");

-- CreateIndex
CREATE INDEX "Material_ownerType_createdAt_idx" ON "Material"("ownerType", "createdAt");

-- CreateIndex
CREATE INDEX "MaterialReport_materialId_createdAt_idx" ON "MaterialReport"("materialId", "createdAt");

-- CreateIndex
CREATE INDEX "MaterialReport_status_createdAt_idx" ON "MaterialReport"("status", "createdAt");

-- CreateIndex
CREATE INDEX "MaterialFavorite_materialId_idx" ON "MaterialFavorite"("materialId");

-- CreateIndex
CREATE UNIQUE INDEX "MaterialFavorite_userId_materialId_key" ON "MaterialFavorite"("userId", "materialId");

-- CreateIndex
CREATE INDEX "MaterialLike_materialId_idx" ON "MaterialLike"("materialId");

-- CreateIndex
CREATE UNIQUE INDEX "MaterialLike_userId_materialId_key" ON "MaterialLike"("userId", "materialId");

-- CreateIndex
CREATE INDEX "PptProject_userId_createdAt_idx" ON "PptProject"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "PptProject_userId_updatedAt_idx" ON "PptProject"("userId", "updatedAt");

-- CreateIndex
CREATE INDEX "PptProject_status_idx" ON "PptProject"("status");

-- CreateIndex
CREATE INDEX "PptProject_createdAt_idx" ON "PptProject"("createdAt");

-- CreateIndex
CREATE INDEX "PptSlide_projectId_order_idx" ON "PptSlide"("projectId", "order");

-- CreateIndex
CREATE UNIQUE INDEX "PptSlide_projectId_order_key" ON "PptSlide"("projectId", "order");

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Generation" ADD CONSTRAINT "Generation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditTransaction" ADD CONSTRAINT "CreditTransaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdminAuditLog" ADD CONSTRAINT "AdminAuditLog_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RegistrationEvent" ADD CONSTRAINT "RegistrationEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserDailyActivity" ADD CONSTRAINT "UserDailyActivity_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Feedback" ADD CONSTRAINT "Feedback_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserApiConfig" ADD CONSTRAINT "UserApiConfig_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImageConversation" ADD CONSTRAINT "ImageConversation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImageTurn" ADD CONSTRAINT "ImageTurn_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "ImageConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Material" ADD CONSTRAINT "Material_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaterialReport" ADD CONSTRAINT "MaterialReport_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "Material"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaterialReport" ADD CONSTRAINT "MaterialReport_reporterId_fkey" FOREIGN KEY ("reporterId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaterialFavorite" ADD CONSTRAINT "MaterialFavorite_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaterialFavorite" ADD CONSTRAINT "MaterialFavorite_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "Material"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaterialLike" ADD CONSTRAINT "MaterialLike_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaterialLike" ADD CONSTRAINT "MaterialLike_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "Material"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PptProject" ADD CONSTRAINT "PptProject_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PptSlide" ADD CONSTRAINT "PptSlide_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "PptProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;
