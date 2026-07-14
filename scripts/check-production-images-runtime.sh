#!/bin/sh
set -eu

web_image="${CONTAINER_WEB_IMAGE:-ai-aggregator-web:local}"
image_worker_image="${CONTAINER_IMAGE_WORKER_IMAGE:-ai-aggregator-image-worker:local}"
ppt_worker_image="${CONTAINER_PPT_WORKER_IMAGE:-ai-aggregator-ppt-worker:local}"
suffix="$$"
network="ai-aggregator-runtime-$suffix"
postgres="ai-aggregator-runtime-postgres-$suffix"
web="ai-aggregator-runtime-web-$suffix"
image_worker="ai-aggregator-runtime-image-worker-$suffix"
ppt_worker="ai-aggregator-runtime-ppt-worker-$suffix"
database_url="postgresql://runtime_user:runtime_password@$postgres:5432/runtime_db?schema=public"

cleanup() {
  status="$?"
  trap - EXIT INT TERM
  set +e
  if [ "$status" -ne 0 ]; then
    docker logs "$web" 2>/dev/null || true
    docker logs "$image_worker" 2>/dev/null || true
    docker logs "$ppt_worker" 2>/dev/null || true
    docker logs "$postgres" 2>/dev/null || true
  fi
  docker rm -f -v "$web" "$image_worker" "$ppt_worker" "$postgres" >/dev/null 2>&1 || true
  docker network rm "$network" >/dev/null 2>&1 || true
  exit "$status"
}
trap cleanup EXIT INT TERM

wait_for_command() {
  description="$1"
  shift
  attempt=1
  while [ "$attempt" -le 60 ]; do
    if "$@" >/dev/null 2>&1; then
      return
    fi
    sleep 1
    attempt=$((attempt + 1))
  done
  echo "Timed out waiting for $description." >&2
  "$@" || true
  return 1
}

runtime_flags="--init --read-only --cap-drop ALL --cap-add CHOWN --cap-add KILL --cap-add SETGID --cap-add SETUID --security-opt no-new-privileges"
runtime_env="-e DATABASE_URL=$database_url -e AUTH_SECRET=runtime-auth-secret-with-sufficient-length -e AUTH_TRUST_HOST=true -e ENCRYPTION_KEY=1111111111111111111111111111111111111111111111111111111111111111"

docker network create "$network" >/dev/null
docker run -d \
  --name "$postgres" \
  --network "$network" \
  -e POSTGRES_DB=runtime_db \
  -e POSTGRES_USER=runtime_user \
  -e POSTGRES_PASSWORD=runtime_password \
  postgres:16-alpine@sha256:57c72fd2a128e416c7fcc499958864df5301e940bca0a56f58fddf30ffc07777 >/dev/null
wait_for_command PostgreSQL docker exec "$postgres" pg_isready -U runtime_user -d runtime_db

# shellcheck disable=SC2086
docker run -d \
  --name "$web" \
  --network "$network" \
  -p 127.0.0.1::3001 \
  $runtime_flags \
  --tmpfs /tmp:rw,noexec,nosuid,nodev,size=128m \
  --tmpfs /app/.next/cache:rw,nosuid,nodev,size=64m,uid=1000,gid=1000 \
  --tmpfs /app/data:rw,nosuid,nodev,size=64m \
  $runtime_env \
  -e DB_SCHEMA_SYNC=true \
  "$web_image" >/dev/null

web_address="$(docker port "$web" 3001/tcp | head -n 1)"
wait_for_command "Web readiness" curl --fail --silent --show-error "http://$web_address/api/health/ready"
docker exec "$web" sh -c '
  test -f scripts/database-index-spec.mjs
  test -f scripts/prepare-production-indexes.mjs
  test -x scripts/migrate-production-db.sh
'
node scripts/check-production-user-journey.mjs "http://$web_address"

# shellcheck disable=SC2086
docker run -d \
  --name "$image_worker" \
  --network "$network" \
  $runtime_flags \
  --tmpfs /tmp:rw,noexec,nosuid,nodev,size=256m \
  --tmpfs /app/data:rw,nosuid,nodev,size=64m \
  $runtime_env \
  "$image_worker_image" >/dev/null

# shellcheck disable=SC2086
docker run -d \
  --name "$ppt_worker" \
  --network "$network" \
  $runtime_flags \
  --tmpfs /tmp:rw,noexec,nosuid,nodev,size=768m \
  --tmpfs /app/data:rw,nosuid,nodev,size=128m \
  $runtime_env \
  "$ppt_worker_image" >/dev/null

wait_for_command "image Worker heartbeat" \
  docker exec "$image_worker" gosu node node scripts/check-image-worker-health.mjs
wait_for_command "PPT Worker heartbeat" \
  docker exec "$ppt_worker" gosu node node scripts/check-ppt-worker-health.mjs
docker exec "$ppt_worker" gosu node /opt/ppt-venv/bin/python -c '
from importlib.metadata import version

assert tuple(map(int, version("setuptools").split("."))) >= (78, 1, 1)
'

for container in "$web" "$image_worker" "$ppt_worker"; do
  test "$(docker inspect "$container" --format '{{.HostConfig.ReadonlyRootfs}}')" = true
  docker exec --user node "$container" sh -c '
    for package_manager in corepack npm npx pnpm pnpx yarn yarnpkg; do
      ! command -v "$package_manager" >/dev/null 2>&1 || exit 1
    done
    found=0
    for status in /proc/[0-9]*/status; do
      [ "$status" = /proc/1/status ] && continue
      uid="$(awk '\''/^Uid:/ { print $2 }'\'' "$status")"
      capabilities="$(awk '\''/^CapEff:/ { print $2 }'\'' "$status")"
      [ "$uid" = 1000 ] || exit 1
      [ "$capabilities" = 0000000000000000 ] || exit 1
      found=1
    done
    [ "$found" = 1 ]
  '
done

docker stop -t 15 "$image_worker" "$ppt_worker" "$web" >/dev/null
for container in "$image_worker" "$ppt_worker"; do
  exit_code="$(docker inspect "$container" --format '{{.State.ExitCode}}')"
  if [ "$exit_code" -ne 0 ]; then
    echo "$container exited with code $exit_code." >&2
    exit 1
  fi
done
web_exit_code="$(docker inspect "$web" --format '{{.State.ExitCode}}')"
if [ "$web_exit_code" -ne 0 ] && [ "$web_exit_code" -ne 143 ]; then
  echo "$web exited with code $web_exit_code." >&2
  exit 1
fi

echo "Production image runtime check passed."
