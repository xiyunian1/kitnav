import { PrismaClient } from "@prisma/client";
import {
  normalizeIndexColumn,
  quoteIdentifier,
  removedDatabaseIndexes,
  requiredDatabaseIndexes,
} from "./database-index-spec.mjs";

const prisma = new PrismaClient();

async function readIndexState() {
  const [tables, columns, indexes] = await Promise.all([
    prisma.$queryRawUnsafe(`
      SELECT table_name AS "tableName"
      FROM information_schema.tables
      WHERE table_schema = current_schema()
        AND table_type = 'BASE TABLE'
    `),
    prisma.$queryRawUnsafe(`
      SELECT table_name AS "tableName", column_name AS "columnName"
      FROM information_schema.columns
      WHERE table_schema = current_schema()
    `),
    prisma.$queryRawUnsafe(`
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
    `),
  ]);
  return {
    tables: new Set(tables.map((row) => row.tableName)),
    columns: new Set(
      columns.map((row) => `${row.tableName}.${row.columnName}`),
    ),
    indexes: new Map(indexes.map((row) => [row.indexName, row])),
  };
}

function matches(index, expected) {
  return (
    index?.tableName === expected.table &&
    index.isValid === true &&
    index.isReady === true &&
    JSON.stringify(index.columns.map(normalizeIndexColumn)) ===
      JSON.stringify(expected.columns)
  );
}

async function main() {
  const state = await readIndexState();
  let changed = 0;

  for (const index of requiredDatabaseIndexes) {
    if (!state.tables.has(index.table)) continue;
    if (
      index.columns.some(
        (column) => !state.columns.has(`${index.table}.${column}`),
      )
    ) {
      continue;
    }
    const current = state.indexes.get(index.name);
    if (matches(current, index)) continue;

    if (current) {
      await prisma.$executeRawUnsafe(
        `DROP INDEX CONCURRENTLY ${quoteIdentifier(index.name)}`,
      );
    }
    await prisma.$executeRawUnsafe(
      `CREATE INDEX CONCURRENTLY ${quoteIdentifier(index.name)} ON ${quoteIdentifier(index.table)} (${index.columns.map(quoteIdentifier).join(", ")})`,
    );
    changed += 1;
  }

  for (const name of removedDatabaseIndexes) {
    if (!state.indexes.has(name)) continue;
    await prisma.$executeRawUnsafe(
      `DROP INDEX CONCURRENTLY ${quoteIdentifier(name)}`,
    );
    changed += 1;
  }

  console.log(
    changed === 0
      ? "Production query indexes already prepared."
      : `Prepared ${changed} production query index change(s).`,
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
