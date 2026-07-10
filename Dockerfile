FROM node:22-alpine AS base
WORKDIR /app

FROM base AS deps
RUN apk add --no-cache libc6-compat openssl
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm install

FROM base AS builder
ARG NEXT_PUBLIC_SITE_URL
ENV NEXT_PUBLIC_SITE_URL=${NEXT_PUBLIC_SITE_URL}
ENV DATABASE_URL=postgresql://ai_aggregator:postgres@localhost:5432/ai_aggregator?schema=public
RUN apk add --no-cache openssl
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate
RUN npm run build

FROM base AS prisma-cli
COPY --from=deps /app/node_modules/prisma/package.json /tmp/prisma-version.json
RUN npm init -y >/dev/null \
  && npm install --no-audit --no-fund "prisma@$(node -p "require('/tmp/prisma-version.json').version")"

FROM base AS ppt-python
RUN apk add --no-cache build-base cairo-dev pkgconf python3 python3-dev py3-pip
COPY scripts/ppt-master/requirements.txt /tmp/ppt-master-requirements.txt
RUN python3 -m venv /opt/ppt-venv \
  && /opt/ppt-venv/bin/pip install --no-cache-dir --upgrade pip \
  && /opt/ppt-venv/bin/pip install --no-cache-dir -r /tmp/ppt-master-requirements.txt

FROM base AS unrar-builder
ARG UNRAR_VERSION=7.2.4
RUN apk add --no-cache build-base ca-certificates wget \
  && wget -q -O /tmp/unrarsrc.tar.gz "https://www.rarlab.com/rar/unrarsrc-${UNRAR_VERSION}.tar.gz" \
  && mkdir -p /tmp/unrar-src \
  && tar -xzf /tmp/unrarsrc.tar.gz -C /tmp/unrar-src --strip-components=1 \
  && make -C /tmp/unrar-src -f makefile \
  && install -m 755 /tmp/unrar-src/unrar /usr/local/bin/unrar

FROM base AS runner
ARG PI_CODING_AGENT_VERSION=0.80.2
ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
ENV PORT=3001
ENV PATH="/opt/ppt-venv/bin:${PATH}"
ENV PI_CODING_AGENT_DIR=/app/data/pi-agent
RUN apk add --no-cache bash cairo fd font-noto-cjk fontconfig gdk-pixbuf libstdc++ openssl p7zip pango python3 ripgrep ttf-dejavu \
  && npm install -g --no-audit --no-fund "@earendil-works/pi-coding-agent@${PI_CODING_AGENT_VERSION}" \
  && npm cache clean --force \
  && if ! command -v 7z >/dev/null 2>&1; then \
    ln -s "$(command -v 7zz || command -v 7za)" /usr/local/bin/7z; \
  fi

COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=prisma-cli /app/node_modules ./node_modules
COPY --from=ppt-python /opt/ppt-venv /opt/ppt-venv
COPY --from=unrar-builder /usr/local/bin/unrar /usr/local/bin/unrar
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/scripts ./scripts
RUN chmod +x ./scripts/docker-entrypoint.sh

EXPOSE 3001
CMD ["sh", "./scripts/docker-entrypoint.sh"]
