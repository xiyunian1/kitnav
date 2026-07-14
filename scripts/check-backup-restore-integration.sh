#!/bin/sh
set -eu

project="ai-aggregator-backup-check"
compose_file="scripts/test-fixtures/postgres-compose.yml"
root="$(mktemp -d)"
data_dir="$root/data"
backup_dir="$root/backups"
mirror_dir="$root/mirror"
restore_dir="$root/restored"
compose_env="$root/compose.env"

printf 'BACKUP_TEST_PASSWORD=backup_test_password\n' >"$compose_env"

compose() {
	docker compose --env-file "$compose_env" -p "$project" -f "$compose_file" "$@"
}

cleanup() {
	compose down -v --remove-orphans >/dev/null 2>&1 || true
	rm -rf "$root"
}
trap cleanup EXIT

compose up -d --wait postgres
compose exec -T postgres \
	psql -U backup_test -d backup_test -v ON_ERROR_STOP=1 \
	-c 'CREATE TABLE restore_probe (id integer PRIMARY KEY, value text NOT NULL); INSERT INTO restore_probe VALUES (1, $$ok$$);'

mkdir -p "$data_dir/uploads/materials" "$data_dir/ppt-projects/probe"
printf 'asset\n' >"$data_dir/uploads/materials/probe.txt"
printf 'deck\n' >"$data_dir/ppt-projects/probe/deck.txt"

compose up -d app
if npm run prod:backup -- \
	--data-dir "$data_dir" \
	--backup-dir "$backup_dir" \
	--env-file "$compose_env" \
	--compose-file "$compose_file" \
	--compose-project "$project" \
	--postgres-service postgres \
	--postgres-user backup_test \
	--postgres-database backup_test; then
	echo "Backup unexpectedly succeeded while an application writer was running."
	exit 1
fi
compose stop app

npm run prod:backup -- \
	--data-dir "$data_dir" \
	--backup-dir "$backup_dir" \
	--mirror-dir "$mirror_dir" \
	--env-file "$compose_env" \
	--compose-file "$compose_file" \
	--compose-project "$project" \
	--postgres-service postgres \
	--postgres-user backup_test \
	--postgres-database backup_test \
	--keep 2

snapshot="$(find "$backup_dir" -mindepth 1 -maxdepth 1 -type d | head -n 1)"
test -n "$snapshot"
test -f "$mirror_dir/$(basename "$snapshot")/manifest.json"
npm run prod:backup:verify -- --snapshot "$snapshot"
npm run prod:restore:drill -- \
	--snapshot "$snapshot" \
	--env-file "$compose_env" \
	--compose-file "$compose_file" \
	--compose-project "$project" \
	--postgres-service postgres \
	--postgres-user backup_test
npm run prod:restore -- \
	--snapshot "$snapshot" \
	--target-database restored_target \
	--data-dir "$restore_dir" \
	--env-file "$compose_env" \
	--compose-file "$compose_file" \
	--compose-project "$project" \
	--postgres-service postgres \
	--postgres-user backup_test \
	--confirm RESTORE:restored_target

restored_value="$(compose exec -T postgres \
	psql -U backup_test -d restored_target -At -c 'SELECT value FROM restore_probe WHERE id = 1;')"
test "$restored_value" = "ok"
test -f "$restore_dir/uploads/materials/probe.txt"
test -f "$restore_dir/ppt-projects/probe/deck.txt"

compose exec -T postgres psql -U backup_test -d restored_target -v ON_ERROR_STOP=1 \
	-c 'UPDATE restore_probe SET value = $$pre-restore$$ WHERE id = 1;'
printf 'pre-restore-file\n' >"$restore_dir/uploads/materials/probe.txt"

npm run prod:restore -- \
	--snapshot "$snapshot" \
	--target-database restored_target \
	--data-dir "$restore_dir" \
	--env-file "$compose_env" \
	--compose-file "$compose_file" \
	--compose-project "$project" \
	--postgres-service postgres \
	--postgres-user backup_test \
	--replace-database true \
	--replace-files true \
	--confirm RESTORE:restored_target

restored_value="$(compose exec -T postgres \
	psql -U backup_test -d restored_target -At -c 'SELECT value FROM restore_probe WHERE id = 1;')"
test "$restored_value" = "ok"
test "$(cat "$restore_dir/uploads/materials/probe.txt")" = "asset"

previous_database="$(compose exec -T postgres psql -U backup_test -d postgres -At \
	-c "SELECT datname FROM pg_database WHERE datname LIKE 'restored_target_pre_%' ORDER BY datname DESC LIMIT 1;")"
test -n "$previous_database"
previous_value="$(compose exec -T postgres \
	psql -U backup_test -d "$previous_database" -At -c 'SELECT value FROM restore_probe WHERE id = 1;')"
test "$previous_value" = "pre-restore"
previous_uploads="$(find "$restore_dir" -maxdepth 1 -type d -name 'uploads.pre-restore-*' | head -n 1)"
test -n "$previous_uploads"
test "$(cat "$previous_uploads/materials/probe.txt")" = "pre-restore-file"

echo "Backup and restore integration check passed."
