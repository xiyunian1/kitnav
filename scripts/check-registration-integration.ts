import assert from "node:assert/strict";

const databaseUrl = process.env.REGISTRATION_INTEGRATION_DATABASE_URL;
if (!databaseUrl) {
  throw new Error("REGISTRATION_INTEGRATION_DATABASE_URL is required");
}
const databaseName = new URL(databaseUrl).pathname.replace(/^\//, "");
if (!databaseName.endsWith("_registration_test")) {
  throw new Error("Integration database name must end with _registration_test");
}

process.env.DATABASE_URL = databaseUrl;

const TEST_EMAIL_SUFFIX = "@registration.integration.test";

async function main() {
  const { prisma } = await import("@/lib/db");
  const { createRegisteredUser, OperationBlockedError } = await import(
    "@/lib/operations"
  );

  async function setPolicy(values: Record<string, string>) {
    await Promise.all(
      Object.entries(values).map(([key, value]) =>
        prisma.setting.upsert({
          where: { key },
          create: { key, value },
          update: { value },
        }),
      ),
    );
  }

  async function clearTestData() {
    await prisma.registrationEvent.deleteMany({
      where: { email: { endsWith: TEST_EMAIL_SUFFIX } },
    });
    await prisma.inviteCode.deleteMany({
      where: { code: { startsWith: "registration-integration-" } },
    });
    await prisma.user.deleteMany({
      where: { email: { endsWith: TEST_EMAIL_SUFFIX } },
    });
  }

  async function registerMany(prefix: string, count: number, extra = {}) {
    return Promise.allSettled(
      Array.from({ length: count }, (_, index) =>
        createRegisteredUser({
          provider: "credentials" as const,
          email: `${prefix}-${index}${TEST_EMAIL_SUFFIX}`,
          passwordHash: "integration-password-hash",
          ...extra,
        }),
      ),
    );
  }

  try {
    await clearTestData();
    await setPolicy({
      registration_mode: "open",
      max_users: "1",
      email_domain_allowlist: "",
      daily_ip_register_limit: "0",
      signup_bonus: "7",
    });
    const maxUsers = await registerMany("max-users", 8);
    assert.equal(maxUsers.filter((result) => result.status === "fulfilled").length, 1);
    assert(
      maxUsers
        .filter((result) => result.status === "rejected")
        .every(
          (result) =>
            result.reason instanceof OperationBlockedError &&
            result.reason.message === "注册人数已达上限",
        ),
    );

    await clearTestData();
    await setPolicy({
      registration_mode: "invite",
      max_users: "0",
      daily_ip_register_limit: "0",
    });
    const invite = await prisma.inviteCode.create({
      data: {
        code: "registration-integration-limited",
        maxUses: 2,
      },
    });
    const invited = await registerMany("invite", 8, {
      inviteCode: invite.code,
    });
    assert.equal(invited.filter((result) => result.status === "fulfilled").length, 2);
    assert.equal(
      (await prisma.inviteCode.findUniqueOrThrow({ where: { id: invite.id } }))
        .usedCount,
      2,
    );

    const invitedUsers = await prisma.user.findMany({
      where: { email: { startsWith: "invite-", endsWith: TEST_EMAIL_SUFFIX } },
    });
    assert.equal(invitedUsers.length, 2);
    assert(invitedUsers.every((user) => user.credits === 7));
    assert.equal(
      await prisma.creditTransaction.count({
        where: { userId: { in: invitedUsers.map((user) => user.id) } },
      }),
      2,
    );
    assert.equal(
      await prisma.registrationEvent.count({
        where: { userId: { in: invitedUsers.map((user) => user.id) } },
      }),
      2,
    );

    await clearTestData();
    await setPolicy({
      registration_mode: "open",
      max_users: "0",
      daily_ip_register_limit: "1",
    });
    const sameIp = await registerMany("same-ip", 8, {
      ip: "203.0.113.10",
      inviteCode: "registration-integration-unused",
    });
    assert.equal(sameIp.filter((result) => result.status === "fulfilled").length, 1);
    assert.equal(
      await prisma.registrationEvent.count({
        where: { ip: "203.0.113.10" },
      }),
      1,
    );
    assert.equal(
      await prisma.inviteCode.count({
        where: { code: "registration-integration-unused" },
      }),
      0,
    );

    console.log("Registration integration check passed.");
  } finally {
    await clearTestData().catch(() => undefined);
    await prisma.$disconnect();
  }
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
