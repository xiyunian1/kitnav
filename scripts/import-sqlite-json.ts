import { readFileSync } from "fs";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

type Row = Record<string, unknown>;
type ExportData = Record<string, Row[]>;

const sourcePath = process.argv[2];

if (!sourcePath) {
  console.error("Usage: tsx scripts/import-sqlite-json.ts <sqlite-export.json>");
  process.exit(1);
}

const data = JSON.parse(readFileSync(sourcePath, "utf8")) as ExportData;

const dateFields: Record<string, string[]> = {
  User: ["emailVerified", "createdAt", "updatedAt"],
  Session: ["expires"],
  VerificationToken: ["expires"],
  Generation: ["createdAt"],
  CreditTransaction: ["createdAt"],
  Order: ["createdAt", "paidAt"],
  RechargePackage: ["createdAt", "updatedAt"],
  Setting: ["updatedAt"],
  AdminAuditLog: ["createdAt"],
  InviteCode: ["expiresAt", "createdAt", "updatedAt"],
  RegistrationEvent: ["createdAt"],
  UserDailyActivity: ["firstSeenAt", "lastSeenAt"],
  SiteAnnouncement: ["createdAt", "updatedAt"],
  Feedback: ["createdAt", "updatedAt"],
  ProviderConfig: ["updatedAt"],
  UserApiConfig: ["updatedAt"],
  ImageConversation: ["createdAt", "updatedAt"],
  ImageTurn: ["createdAt"],
  PptProject: ["createdAt", "updatedAt"],
  PptSlide: ["createdAt", "updatedAt"],
  Material: ["reviewedAt", "createdAt", "updatedAt"],
  MaterialReport: ["createdAt", "resolvedAt"],
  MaterialFavorite: ["createdAt"],
  MaterialLike: ["createdAt"],
};

const booleanFields: Record<string, string[]> = {
  Generation: ["usedOwnKey"],
  RechargePackage: ["enabled", "popular"],
  InviteCode: ["enabled"],
  SiteAnnouncement: ["enabled"],
  ProviderConfig: ["enabled"],
  UserApiConfig: ["enabled"],
  ImageTurn: ["usedOwnKey"],
  PptProject: ["usedOwnKey"],
};

const importOrder = [
  "User",
  "Account",
  "Session",
  "VerificationToken",
  "Generation",
  "CreditTransaction",
  "Order",
  "RechargePackage",
  "Setting",
  "AdminAuditLog",
  "InviteCode",
  "RegistrationEvent",
  "UserDailyActivity",
  "SiteAnnouncement",
  "Feedback",
  "ProviderConfig",
  "UserApiConfig",
  "ImageConversation",
  "ImageTurn",
  "PptProject",
  "PptSlide",
  "Material",
  "MaterialReport",
  "MaterialFavorite",
  "MaterialLike",
] as const;

const batchSize = 100;

type ModelDelegate = {
  deleteMany: () => Promise<unknown>;
  createMany: (args: { data: Row[] }) => Promise<unknown>;
};

const delegates: Record<string, ModelDelegate> = {
  User: prisma.user as unknown as ModelDelegate,
  Account: prisma.account as unknown as ModelDelegate,
  Session: prisma.session as unknown as ModelDelegate,
  VerificationToken: prisma.verificationToken as unknown as ModelDelegate,
  Generation: prisma.generation as unknown as ModelDelegate,
  CreditTransaction: prisma.creditTransaction as unknown as ModelDelegate,
  Order: prisma.order as unknown as ModelDelegate,
  RechargePackage: prisma.rechargePackage as unknown as ModelDelegate,
  Setting: prisma.setting as unknown as ModelDelegate,
  AdminAuditLog: prisma.adminAuditLog as unknown as ModelDelegate,
  InviteCode: prisma.inviteCode as unknown as ModelDelegate,
  RegistrationEvent: prisma.registrationEvent as unknown as ModelDelegate,
  UserDailyActivity: prisma.userDailyActivity as unknown as ModelDelegate,
  SiteAnnouncement: prisma.siteAnnouncement as unknown as ModelDelegate,
  Feedback: prisma.feedback as unknown as ModelDelegate,
  ProviderConfig: prisma.providerConfig as unknown as ModelDelegate,
  UserApiConfig: prisma.userApiConfig as unknown as ModelDelegate,
  ImageConversation: prisma.imageConversation as unknown as ModelDelegate,
  ImageTurn: prisma.imageTurn as unknown as ModelDelegate,
  PptProject: prisma.pptProject as unknown as ModelDelegate,
  PptSlide: prisma.pptSlide as unknown as ModelDelegate,
  Material: prisma.material as unknown as ModelDelegate,
  MaterialReport: prisma.materialReport as unknown as ModelDelegate,
  MaterialFavorite: prisma.materialFavorite as unknown as ModelDelegate,
  MaterialLike: prisma.materialLike as unknown as ModelDelegate,
};

function normalizeRow(table: string, row: Row) {
  const normalized = { ...row };

  for (const field of dateFields[table] ?? []) {
    const value = normalized[field];
    if (value === null || value === undefined) continue;
    normalized[field] = typeof value === "number" ? new Date(value) : new Date(String(value));
  }

  for (const field of booleanFields[table] ?? []) {
    const value = normalized[field];
    if (value === null || value === undefined) continue;
    normalized[field] = value === true || value === 1 || value === "1";
  }

  return normalized;
}

async function main() {
  for (const table of [...importOrder].reverse()) {
    await delegates[table].deleteMany();
  }

  for (const table of importOrder) {
    const rows = data[table] ?? [];
    if (rows.length === 0) {
      console.log(`${table}: 0`);
      continue;
    }

    for (let i = 0; i < rows.length; i += batchSize) {
      await delegates[table].createMany({
        data: rows.slice(i, i + batchSize).map((row) => normalizeRow(table, row)),
      });
    }
    console.log(`${table}: ${rows.length}`);
  }
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
