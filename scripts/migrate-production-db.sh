#!/bin/sh
set -eu

schema_path="./prisma/schema.prisma"
prisma_cli="./node_modules/prisma/build/index.js"
baseline_migration="20260711000000_baseline"
baseline_sql="./prisma/migrations/$baseline_migration/migration.sql"
prepare_indexes="./scripts/prepare-production-indexes.mjs"

wait_for_database() {
  for attempt in $(seq 1 60); do
    if printf 'SELECT 1;' | node "$prisma_cli" db execute --stdin --schema "$schema_path" >/dev/null 2>&1; then
      return
    fi
    echo "Waiting for database... ($attempt/60)"
    sleep 2
  done

  echo "Database did not become ready in time."
  exit 1
}

deploy_migrations() {
  node "$prisma_cli" migrate deploy --schema "$schema_path"
}

baseline_legacy_database() {
	diff_output="$(mktemp)"
	baseline_database="$(node ./scripts/prisma-baseline-shadow.mjs name)"
	baseline_url=""
	cleanup_baseline_shadow() {
		if [ -n "$baseline_url" ]; then
			node ./scripts/prisma-baseline-shadow.mjs drop "$baseline_database" >/dev/null 2>&1 || true
		fi
		rm -f "$diff_output"
	}
	trap cleanup_baseline_shadow EXIT

	baseline_url="$(node ./scripts/prisma-baseline-shadow.mjs create "$baseline_database")"
	node "$prisma_cli" db execute \
		--file "$baseline_sql" \
		--url "$baseline_url" >/dev/null

	set +e
	node "$prisma_cli" migrate diff \
		--exit-code \
		--from-url "$DATABASE_URL" \
		--to-url "$baseline_url" >"$diff_output" 2>&1
  diff_status=$?
  set -e

	if [ "$diff_status" -eq 2 ]; then
		echo "Existing database differs from the production baseline; refusing to mark the baseline migration as applied."
    cat "$diff_output"
    exit 1
  fi
  if [ "$diff_status" -ne 0 ]; then
    echo "Could not compare the existing database with prisma/schema.prisma."
    cat "$diff_output"
    exit "$diff_status"
  fi

	echo "Existing database matches the production baseline; recording the Prisma migration baseline."
  node "$prisma_cli" migrate resolve \
    --applied "$baseline_migration" \
    --schema "$schema_path"
}

wait_for_database
database_state="$(node ./scripts/check-prisma-migration-state.mjs)"

case "$database_state" in
  managed|empty)
    ;;
  legacy)
    baseline_legacy_database
    ;;
  *)
    echo "Unknown database migration state: $database_state"
    exit 1
    ;;
esac

node "$prepare_indexes"
deploy_migrations
