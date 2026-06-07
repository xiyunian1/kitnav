#!/bin/sh
set -eu

for i in $(seq 1 60); do
  if node node_modules/prisma/build/index.js db push --skip-generate; then
    exec node server.js
  fi

  echo "Waiting for database... ($i/60)"
  sleep 2
done

node node_modules/prisma/build/index.js db push --skip-generate
exec node server.js
