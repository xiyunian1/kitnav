import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  const email = "xiyunian1@gmail.com";
  const pwd = "Mima12345.";
  const hash = await bcrypt.hash(pwd, 10);

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    await prisma.user.update({
      where: { email },
      data: { passwordHash: hash, role: "ADMIN", status: "ACTIVE" },
    });
    console.log("RESULT: 已更新现有账号为管理员");
  } else {
    await prisma.user.create({
      data: {
        email,
        name: "管理员",
        passwordHash: hash,
        role: "ADMIN",
        status: "ACTIVE",
        credits: 100000,
      },
    });
    console.log("RESULT: 已创建管理员");
  }

  const check = await prisma.user.findUnique({ where: { email } });
  const ok = await bcrypt.compare(pwd, check!.passwordHash!);
  console.log(
    `RESULT: 密码校验=${ok ? "通过" : "失败"} role=${check!.role} status=${check!.status}`
  );
}

main()
  .then(() => prisma.$disconnect())
  .catch((e) => {
    console.error("ERROR:", e);
    prisma.$disconnect();
    process.exit(1);
  });
