import { prisma } from "@/lib/db";

export const DEFAULT_CREDIT_PACKAGES = [
  { code: "basic", credits: 100, amount: 100, label: "体验包", popular: false, sortOrder: 10 },
  { code: "standard", credits: 500, amount: 500, label: "标准包", popular: true, sortOrder: 20 },
  { code: "pro", credits: 1200, amount: 1200, label: "超值包", popular: false, sortOrder: 30 },
  { code: "max", credits: 3000, amount: 3000, label: "尊享包", popular: false, sortOrder: 40 },
] as const;

export type RechargePackageView = {
  id: string;
  code: string;
  credits: number;
  amount: number;
  label: string;
  popular: boolean;
  enabled: boolean;
  sortOrder: number;
};

export async function ensureDefaultRechargePackages() {
  const count = await prisma.rechargePackage.count();
  if (count > 0) return;
  await prisma.rechargePackage.createMany({
    data: DEFAULT_CREDIT_PACKAGES.map((pkg) => ({ ...pkg, enabled: true })),
  });
}

export async function listRechargePackages(includeDisabled = false): Promise<RechargePackageView[]> {
  await ensureDefaultRechargePackages();
  return prisma.rechargePackage.findMany({
    where: includeDisabled ? undefined : { enabled: true },
    orderBy: [{ sortOrder: "asc" }, { amount: "asc" }],
  });
}

export async function getRechargePackage(codeOrId: string) {
  await ensureDefaultRechargePackages();
  return prisma.rechargePackage.findFirst({
    where: {
      enabled: true,
      OR: [{ id: codeOrId }, { code: codeOrId }],
    },
  });
}
