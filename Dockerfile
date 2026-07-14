FROM node:26-bookworm-slim@sha256:793dcf7e4fd720d5752b2d63e120e24e64571fafc4cfec87962a2fdb71e0cf30 AS base
WORKDIR /app

FROM base AS build-base
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl \
  && rm -rf /var/lib/apt/lists/*

FROM build-base AS deps
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN --mount=type=cache,target=/root/.npm,sharing=locked \
  npm ci --no-audit --no-fund

FROM build-base AS builder
ARG NEXT_PUBLIC_SITE_URL
ENV NEXT_PUBLIC_SITE_URL=${NEXT_PUBLIC_SITE_URL}
ENV DATABASE_URL=postgresql://ai_aggregator:postgres@localhost:5432/ai_aggregator?schema=public
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build
RUN npm run ppt-worker:build \
	&& npm run image-worker:build

FROM build-base AS prisma-cli
COPY --from=deps /app/node_modules/prisma/package.json /tmp/prisma-version.json
RUN --mount=type=cache,target=/root/.npm,sharing=locked \
  npm init -y >/dev/null \
  && npm install --no-audit --no-fund "prisma@$(node -p "require('/tmp/prisma-version.json').version")"

FROM base AS pi-agent-deps
COPY scripts/pi-agent-runtime/package.json scripts/pi-agent-runtime/package-lock.json /opt/pi-agent/
RUN --mount=type=cache,target=/root/.npm,sharing=locked \
	npm ci --omit=dev --no-audit --no-fund --prefix /opt/pi-agent

FROM base AS ppt-python
ARG PPT_PIP_VERSION=26.1.2
ARG PPT_SETUPTOOLS_VERSION=83.0.0
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates python3 python3-venv \
  && rm -rf /var/lib/apt/lists/*
COPY scripts/ppt-master/requirements.txt /tmp/ppt-master-requirements.txt
COPY scripts/ppt-requirements.lock /tmp/ppt-master-requirements.lock
RUN --mount=type=cache,target=/root/.cache/pip,sharing=locked \
  python3 -m venv /opt/ppt-venv \
  && /opt/ppt-venv/bin/pip install \
    "pip==${PPT_PIP_VERSION}" \
    "setuptools==${PPT_SETUPTOOLS_VERSION}" \
  && /opt/ppt-venv/bin/pip install \
    --only-binary=:all: \
    --require-hashes \
    -r /tmp/ppt-master-requirements.lock

FROM base AS unrar-builder
ARG UNRAR_VERSION=7.2.4
ARG UNRAR_SHA256=b02e571a33af7711cd803080500370dc1d28eea82b2032480819d27462ad8b31
RUN apt-get update \
  && apt-get install -y --no-install-recommends build-essential ca-certificates wget \
  && wget -q -O /tmp/unrarsrc.tar.gz "https://www.rarlab.com/rar/unrarsrc-${UNRAR_VERSION}.tar.gz" \
  && echo "${UNRAR_SHA256}  /tmp/unrarsrc.tar.gz" | sha256sum -c - \
  && mkdir -p /tmp/unrar-src \
  && tar -xzf /tmp/unrarsrc.tar.gz -C /tmp/unrar-src --strip-components=1 \
  && make -C /tmp/unrar-src -f makefile \
  && install -m 755 /tmp/unrar-src/unrar /usr/local/bin/unrar \
  && rm -rf /var/lib/apt/lists/* /tmp/unrar-src /tmp/unrarsrc.tar.gz

FROM base AS runtime-base
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV HOSTNAME=0.0.0.0
ENV PORT=3001
RUN apt-get update \
	&& apt-get install -y --no-install-recommends \
		ca-certificates gosu openssl \
	&& rm -rf \
		/var/lib/apt/lists/* \
		/usr/local/lib/node_modules/corepack \
		/usr/local/lib/node_modules/npm \
	&& rm -f \
		/usr/local/bin/corepack \
		/usr/local/bin/npm \
		/usr/local/bin/npx \
		/usr/local/bin/pnpm \
		/usr/local/bin/pnpx \
		/usr/local/bin/yarn \
		/usr/local/bin/yarnpkg

FROM runtime-base AS worker-runtime-base
ENV DB_SCHEMA_SYNC=false
COPY --from=builder /app/.next/standalone/node_modules ./node_modules

FROM worker-runtime-base AS image-worker-runner
COPY --from=builder /app/.next/image-worker.cjs ./scripts/image-worker.cjs
COPY --from=builder /app/scripts/check-image-worker-health.mjs ./scripts/check-image-worker-health.mjs
COPY scripts/docker-entrypoint.sh ./scripts/docker-entrypoint.sh
RUN chmod +x ./scripts/docker-entrypoint.sh
CMD ["sh", "./scripts/docker-entrypoint.sh", "image-worker"]

FROM worker-runtime-base AS ppt-worker-runner
ENV PATH="/opt/ppt-venv/bin:${PATH}"
ENV PYTHONDONTWRITEBYTECODE=1
RUN apt-get update \
	&& apt-get install -y --no-install-recommends \
		bash fd-find fontconfig fonts-dejavu-core fonts-noto-cjk \
		libgdk-pixbuf-2.0-0 libpango-1.0-0 libcairo2 libstdc++6 \
		p7zip-full python3 ripgrep wget \
	&& if ! command -v fd >/dev/null 2>&1; then \
		ln -s "$(command -v fdfind)" /usr/local/bin/fd; \
	fi \
	&& if ! command -v 7z >/dev/null 2>&1; then \
		ln -s "$(command -v 7zz || command -v 7za)" /usr/local/bin/7z; \
	fi \
	&& rm -rf /var/lib/apt/lists/*
COPY --from=pi-agent-deps /opt/pi-agent /opt/pi-agent
RUN ln -s /opt/pi-agent/node_modules/.bin/pi /usr/local/bin/pi
COPY --from=ppt-python /opt/ppt-venv /opt/ppt-venv
COPY --from=unrar-builder /usr/local/bin/unrar /usr/local/bin/unrar
COPY --from=builder /app/.next/ppt-worker.cjs ./scripts/ppt-worker.cjs
COPY --from=builder /app/scripts/check-ppt-worker-health.mjs ./scripts/check-ppt-worker-health.mjs
COPY --from=builder /app/scripts/ppt-agent-extension.mjs ./scripts/ppt-agent-extension.mjs
COPY --from=builder /app/scripts/ppt-agent-extension-core.mjs ./scripts/ppt-agent-extension-core.mjs
COPY --from=builder /app/scripts/ppt-master.upstream.json ./scripts/ppt-master.upstream.json
COPY --from=builder /app/scripts/ppt-master ./scripts/ppt-master
COPY scripts/docker-entrypoint.sh ./scripts/docker-entrypoint.sh
RUN chmod +x ./scripts/docker-entrypoint.sh
CMD ["sh", "./scripts/docker-entrypoint.sh", "worker"]

FROM runtime-base AS web-runner
RUN apt-get update \
	&& apt-get install -y --no-install-recommends wget \
	&& rm -rf /var/lib/apt/lists/*
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
COPY --from=builder /app/prisma ./prisma
COPY --from=prisma-cli /app/node_modules ./node_modules
COPY --from=builder /app/scripts/check-prisma-migration-state.mjs ./scripts/check-prisma-migration-state.mjs
COPY --from=builder /app/scripts/database-index-spec.mjs ./scripts/database-index-spec.mjs
COPY --from=builder /app/scripts/prepare-production-indexes.mjs ./scripts/prepare-production-indexes.mjs
COPY --from=builder /app/scripts/migrate-production-db.sh ./scripts/migrate-production-db.sh
COPY --from=builder /app/scripts/prisma-baseline-shadow.mjs ./scripts/prisma-baseline-shadow.mjs
COPY scripts/docker-entrypoint.sh ./scripts/docker-entrypoint.sh
RUN mkdir -p ./.next/cache \
	&& chown node:node ./.next/cache \
	&& chmod +x ./scripts/docker-entrypoint.sh ./scripts/migrate-production-db.sh

EXPOSE 3001
CMD ["sh", "./scripts/docker-entrypoint.sh"]
