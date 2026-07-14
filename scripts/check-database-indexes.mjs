import { PrismaClient } from "@prisma/client";
import {
  normalizeIndexColumn,
  removedDatabaseIndexes,
  requiredDatabaseIndexes,
} from "./database-index-spec.mjs";

const prisma = new PrismaClient();

async function main() {
  const rows = await prisma.$queryRawUnsafe(`
    SELECT
      table_class.relname AS "tableName",
      index_class.relname AS "indexName",
      pg_index.indisvalid AS "isValid",
      pg_index.indisready AS "isReady",
      ARRAY(
        SELECT pg_get_indexdef(pg_index.indexrelid, position, TRUE)
        FROM generate_series(1, pg_index.indnkeyatts) AS position
        ORDER BY position
      ) AS columns
    FROM pg_index
    JOIN pg_class AS table_class ON table_class.oid = pg_index.indrelid
    JOIN pg_class AS index_class ON index_class.oid = pg_index.indexrelid
    JOIN pg_namespace ON pg_namespace.oid = table_class.relnamespace
    WHERE pg_namespace.nspname = current_schema()
  `);
  const indexes = new Map(rows.map((row) => [row.indexName, row]));
  const failures = [];

  for (const expected of requiredDatabaseIndexes) {
    const state = indexes.get(expected.name);
    const columns = state?.columns.map(normalizeIndexColumn) ?? [];
    if (!state) {
      failures.push(`missing index: ${expected.name}`);
    } else if (!state.isValid || !state.isReady) {
      failures.push(`index is not valid and ready: ${expected.name}`);
    } else if (
      state.tableName !== expected.table ||
      JSON.stringify(columns) !== JSON.stringify(expected.columns)
    ) {
      failures.push(`index definition does not match: ${expected.name}`);
    }
  }

  for (const name of removedDatabaseIndexes) {
    if (indexes.has(name)) failures.push(`redundant index still exists: ${name}`);
  }

  if (failures.length > 0) throw new Error(failures.join("\n"));

  console.log(
    `Database index checks passed (${requiredDatabaseIndexes.length} required, ${removedDatabaseIndexes.length} removed).`,
  );
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
