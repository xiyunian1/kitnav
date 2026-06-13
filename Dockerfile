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

# 独立安装 prisma CLI（entrypoint 跑 db push 用），让 npm 解析完整依赖闭包，
# 避免 runner 复制整个 node_modules（standalone 已自带运行时依赖）
FROM base AS prisma-cli
COPY --from=deps /app/node_modules/prisma/package.json /tmp/prisma-version.json
RUN npm init -y >/dev/null \
  && npm install --no-audit --no-fund "prisma@$(node -p "require('/tmp/prisma-version.json').version")"

FROM base AS runner
ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
ENV PORT=3001
RUN apk add --no-cache openssl

COPY --from=builder /app/public ./public
# standalone 已内含运行所需 node_modules（含 .prisma/client 与 query engine）
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
# 只补充 entrypoint 跑 `prisma db push` 所需的 CLI（独立 stage 安装，依赖闭包完整）
COPY --from=prisma-cli /app/node_modules ./node_modules
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/scripts ./scripts
RUN chmod +x ./scripts/docker-entrypoint.sh

EXPOSE 3001
CMD ["./scripts/docker-entrypoint.sh"]
