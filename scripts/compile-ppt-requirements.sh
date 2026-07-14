#!/bin/sh
set -eu

repo_dir="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
requirements_dir="$repo_dir/scripts/ppt-master"
lock_file="$repo_dir/scripts/ppt-requirements.lock"
mode="${1:-write}"

case "$mode" in
  write|--check) ;;
  *)
    echo "Usage: $0 [--check]" >&2
    exit 2
    ;;
esac

python_image="${PPT_REQUIREMENTS_PYTHON_IMAGE:-python:3.11-slim@sha256:e031123e3d85762b141ad1cbc56452ba69c6e722ebf2f042cc0dc86c47c0d8b3}"
pip_tools_version="${PPT_REQUIREMENTS_PIP_TOOLS_VERSION:-7.5.2}"
tmp_dir="$(mktemp -d "${TMPDIR:-/tmp}/ppt-requirements.XXXXXX")"
trap 'rm -rf "$tmp_dir"' EXIT INT TERM

# Seed checks from the committed lock so an unrelated package release does not
# make CI fail. Write mode intentionally resolves current compatible versions.
if [ "$mode" = "--check" ] && [ -f "$lock_file" ]; then
  cp "$lock_file" "$tmp_dir/requirements.lock"
fi

docker run --rm \
  --user "$(id -u):$(id -g)" \
  -e HOME=/tmp \
  -e "PIP_TOOLS_VERSION=$pip_tools_version" \
  -v "$requirements_dir:/input:ro" \
  -v "$tmp_dir:/output" \
  -w /input \
  "$python_image" \
  sh -ec '
    python -m venv /tmp/ppt-lock-venv
    /tmp/ppt-lock-venv/bin/pip install \
      --disable-pip-version-check \
      --no-cache-dir \
      "pip-tools==$PIP_TOOLS_VERSION" \
      "build==1.5.1" \
      "click==8.4.2" \
      "packaging==26.2" \
      "pyproject-hooks==1.2.0" \
      "wheel==0.47.0"
    /tmp/ppt-lock-venv/bin/pip-compile \
      --generate-hashes \
      --no-emit-index-url \
      --output-file=/output/requirements.lock \
      --quiet \
      --resolver=backtracking \
      --strip-extras \
      /input/requirements.txt
  '

generated_lock="$tmp_dir/requirements.lock"
if [ "$mode" = "--check" ]; then
  if ! cmp -s "$lock_file" "$generated_lock"; then
    echo "PPT Python dependency lock is stale." >&2
    echo "Run: npm run ppt-requirements:lock" >&2
    exit 1
  fi
  echo "PPT Python dependency lock is current."
  exit 0
fi

mv "$generated_lock" "$lock_file"
echo "Updated $lock_file"
