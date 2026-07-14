#!/bin/sh
set -eu

repo_dir="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
cd "$repo_dir"

site_url="${NEXT_PUBLIC_SITE_URL:-https://ai.kitnav.com}"

build_image() {
  target="$1"
  tag="$2"
  docker build \
    --target "$target" \
    --build-arg "NEXT_PUBLIC_SITE_URL=$site_url" \
    --tag "$tag" \
    .
}

build_image web-runner ai-aggregator-web:local
build_image image-worker-runner ai-aggregator-image-worker:local
build_image ppt-worker-runner ai-aggregator-ppt-worker:local
