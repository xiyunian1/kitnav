#!/bin/sh
set -eu

drop_runtime_privileges() {
	if [ "$(id -u)" -ne 0 ]; then
		return
	fi

	mode="${1:-web}"
	paths="/app/data/uploads /app/data/ppt-uploads /app/data/ppt-projects /app/data/image-inputs"
	if [ "$mode" = "worker" ]; then
		paths="/app/data/ppt-uploads /app/data/ppt-projects"
	elif [ "$mode" = "image-worker" ]; then
		paths="/app/data/uploads /app/data/image-inputs"
	fi
	node_owner="$(id -u node):$(id -g node)"
	for path in $paths; do
		mkdir -p "$path"
		if [ "$(stat -c '%u:%g' "$path")" != "$node_owner" ]; then
			chown -hR node:node "$path"
		fi
	done
	exec gosu node sh "$0" "$@"
}

check_image_worker_runtime() {
	if [ "${1:-web}" != "image-worker" ]; then
		return
	fi
	if [ ! -f ./scripts/image-worker.cjs ]; then
		echo "Image worker bundle is missing."
		exit 1
	fi
}

check_ppt_worker_runtime() {
	if [ "${1:-web}" != "worker" ]; then
		return
	fi

  if ! command -v pi >/dev/null 2>&1; then
    echo "PPT generation requires pi, but pi is not installed."
    exit 1
  fi
	if [ ! -f ./scripts/ppt-worker.cjs ]; then
		echo "PPT worker bundle is missing."
		exit 1
	fi
}

sync_database_schema() {
	if [ "${DB_SCHEMA_SYNC:-true}" != "true" ]; then
		return
	fi

	sh ./scripts/migrate-production-db.sh
}

mode="${1:-web}"
drop_runtime_privileges "$@"
sync_database_schema
check_ppt_worker_runtime "$mode"
check_image_worker_runtime "$mode"

if [ "$mode" = "worker" ]; then
	exec node scripts/ppt-worker.cjs
fi

if [ "$mode" = "image-worker" ]; then
	exec node scripts/image-worker.cjs
fi

exec node server.js
