#!/bin/sh
set -eu

setup_pi_agent() {
  if ! command -v pi >/dev/null 2>&1; then
    echo "PPT generation requires pi, but pi is not installed."
    exit 1
  fi

  export PI_CODING_AGENT_DIR="${PI_CODING_AGENT_DIR:-/app/data/pi-agent}"
  mkdir -p "$PI_CODING_AGENT_DIR"

  if [ -n "${PPT_PI_PROVIDER:-}" ] && [ -n "${PPT_PI_MODEL:-${PPT_AGENT_MODEL:-}}" ] && [ -n "${PPT_PI_BASE_URL:-}" ] && [ -n "${PPT_PI_API_KEY:-}" ]; then
    node scripts/setup-pi-agent.mjs
    # shellcheck disable=SC1091
    . "$PI_CODING_AGENT_DIR/env.sh"
    return
  fi

  if [ "${PPT_PI_USE_PLATFORM_CONFIG:-true}" = "true" ]; then
    node scripts/setup-pi-agent.mjs --from-platform || {
      echo "Unable to prepare pi config from platform PPT provider config."
      echo "Set PPT_PI_PROVIDER, PPT_PI_MODEL, PPT_PI_BASE_URL and PPT_PI_API_KEY, or enable/configure platform PPT provider."
      exit 1
    }
    # shellcheck disable=SC1091
    . "$PI_CODING_AGENT_DIR/env.sh"
    return
  fi

  echo "PPT generation requires pi config."
  echo "Set PPT_PI_PROVIDER, PPT_PI_MODEL, PPT_PI_BASE_URL and PPT_PI_API_KEY, or set PPT_PI_USE_PLATFORM_CONFIG=true."
  exit 1
}

for i in $(seq 1 60); do
  if node node_modules/prisma/build/index.js db push --skip-generate; then
    setup_pi_agent
    exec node server.js
  fi

  echo "Waiting for database... ($i/60)"
  sleep 2
done

node node_modules/prisma/build/index.js db push --skip-generate
setup_pi_agent
exec node server.js
