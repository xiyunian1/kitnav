import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";

const action = process.argv[2];
const database = process.argv[3];

if (action === "name") {
  process.stdout.write(`prisma_baseline_${randomUUID().replaceAll("-", "")}`);
  process.exit(0);
}

if (!database || !/^prisma_baseline_[a-f0-9]{32}$/.test(database)) {
  throw new Error("Invalid Prisma baseline shadow database name");
}

const prisma = new PrismaClient();
try {
  if (action === "create") {
    await prisma.$executeRawUnsafe(`CREATE DATABASE "${database}"`);
    const url = new URL(process.env.DATABASE_URL);
    url.pathname = `/${database}`;
    url.searchParams.set("schema", "public");
    process.stdout.write(url.toString());
  } else if (action === "drop") {
    await prisma.$executeRawUnsafe(
      "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()",
      database,
    );
    await prisma.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${database}"`);
  } else {
    throw new Error(`Unknown Prisma baseline shadow action: ${action}`);
  }
} finally {
  await prisma.$disconnect();
}
