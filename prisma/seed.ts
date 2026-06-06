import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { DEFAULT_SETTINGS } from "../src/lib/settings-config";
import { DEFAULT_CREDIT_PACKAGES } from "../src/lib/recharge-packages";

const prisma = new PrismaClient();

async function main() {
  // 1. 初始化系统设置（已存在则跳过，不覆盖管理员的改动）
  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
    await prisma.setting.upsert({
      where: { key },
      update: {},
      create: { key, value },
    });
  }
  console.log(`✓ 已初始化 ${Object.keys(DEFAULT_SETTINGS).length} 项系统设置`);

  for (const pkg of DEFAULT_CREDIT_PACKAGES) {
    await prisma.rechargePackage.upsert({
      where: { code: pkg.code },
      update: {},
      create: { ...pkg, enabled: true },
    });
  }
  console.log(`✓ 已初始化 ${DEFAULT_CREDIT_PACKAGES.length} 个充值套餐`);

  // 2. 创建默认管理员账号
  const adminEmail = process.env.ADMIN_EMAIL || "admin@example.com";
  const adminPassword = process.env.ADMIN_PASSWORD || "admin123456";
  const adminName = process.env.ADMIN_NAME || "管理员";

  const existing = await prisma.user.findUnique({ where: { email: adminEmail } });
  if (existing) {
    console.log(`✓ 管理员已存在：${adminEmail}（跳过）`);
  } else {
    const passwordHash = await bcrypt.hash(adminPassword, 10);
    await prisma.user.create({
      data: {
        email: adminEmail,
        name: adminName,
        passwordHash,
        role: "ADMIN",
        credits: 100000,
      },
    });
    console.log(`✓ 已创建管理员：${adminEmail} / ${adminPassword}`);
  }
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
