import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

try {
  const [state] = await prisma.$queryRawUnsafe(`
    SELECT
      EXISTS (
        SELECT 1
        FROM information_schema.tables
        WHERE table_schema = current_schema()
          AND table_name = '_prisma_migrations'
      ) AS managed,
      COUNT(*) FILTER (
        WHERE table_schema = current_schema()
          AND table_type = 'BASE TABLE'
          AND table_name <> '_prisma_migrations'
      ) AS user_table_count
    FROM information_schema.tables
  `);

  if (state?.managed) {
    process.stdout.write("managed");
  } else if (Number(state?.user_table_count ?? 0) === 0) {
    process.stdout.write("empty");
  } else {
    process.stdout.write("legacy");
  }
} finally {
  await prisma.$disconnect();
}
