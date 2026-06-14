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

FROM base AS runner
ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
ENV PORT=3001
ENV PATH="/opt/ppt-venv/bin:${PATH}"
RUN apk add --no-cache cairo fontconfig gdk-pixbuf openssl pango python3 ttf-dejavu

COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=prisma-cli /app/node_modules ./node_modules
COPY --from=ppt-python /opt/ppt-venv /opt/ppt-venv
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/scripts ./scripts
RUN chmod +x ./scripts/docker-entrypoint.sh

EXPOSE 3001
CMD ["./scripts/docker-entrypoint.sh"]
