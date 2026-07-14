import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { resolveAdminSeedCredentials } from "./admin-credentials";

const prisma = new PrismaClient();

async function main() {
  const admin = resolveAdminSeedCredentials(process.env);
  if (!admin) {
    throw new Error("ADMIN_EMAIL and ADMIN_PASSWORD are required.");
  }
  const hash = await bcrypt.hash(admin.password, 10);

  const existing = await prisma.user.findUnique({ where: { email: admin.email } });
  if (existing) {
    await prisma.user.update({
      where: { email: admin.email },
      data: {
        name: admin.name,
        passwordHash: hash,
        role: "ADMIN",
        status: "ACTIVE",
      },
    });
    console.log("RESULT: 已更新现有账号为管理员");
  } else {
    await prisma.user.create({
      data: {
        email: admin.email,
        name: admin.name,
        passwordHash: hash,
        role: "ADMIN",
        status: "ACTIVE",
        credits: 100000,
      },
    });
    console.log("RESULT: 已创建管理员");
  }

  const check = await prisma.user.findUnique({ where: { email: admin.email } });
  const ok = Boolean(
    check?.passwordHash && (await bcrypt.compare(admin.password, check.passwordHash)),
  );
  console.log(
    `RESULT: 密码校验=${ok ? "通过" : "失败"} role=${check?.role ?? "未知"} status=${check?.status ?? "未知"}`,
  );
}

main()
  .then(() => prisma.$disconnect())
  .catch((e) => {
    console.error("ERROR:", e);
    prisma.$disconnect();
    process.exit(1);
  });
