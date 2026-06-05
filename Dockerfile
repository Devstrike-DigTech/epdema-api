# syntax=docker/dockerfile:1.7

# ─────────────────────────────────────────────────────────────────────
# Base — pnpm enabled, working dir set
# ─────────────────────────────────────────────────────────────────────
FROM node:20-alpine AS base
RUN corepack enable && corepack prepare pnpm@10.29.2 --activate
WORKDIR /app
# OpenSSL needed by Prisma at runtime on alpine
RUN apk add --no-cache openssl libc6-compat

# ─────────────────────────────────────────────────────────────────────
# Dev — full deps, mount source over volume
# ─────────────────────────────────────────────────────────────────────
FROM base AS dev
ENV NODE_ENV=development
COPY package.json pnpm-lock.yaml* ./
RUN pnpm install --frozen-lockfile || pnpm install
COPY prisma ./prisma
RUN pnpm prisma generate
COPY . .
EXPOSE 3001
CMD ["pnpm", "dev"]

# ─────────────────────────────────────────────────────────────────────
# Deps — production-only deps
# ─────────────────────────────────────────────────────────────────────
FROM base AS deps
COPY package.json pnpm-lock.yaml* ./
RUN pnpm install --prod --frozen-lockfile || pnpm install --prod
# Generate the Prisma client INTO the prod node_modules. pnpm blocks the
# @prisma/client postinstall by default, so without this explicit step the
# prod image ships an un-generated client stub and crashes at boot.
COPY prisma ./prisma
RUN pnpm prisma generate

# ─────────────────────────────────────────────────────────────────────
# Builder — build TypeScript to dist/
# ─────────────────────────────────────────────────────────────────────
FROM base AS builder
COPY package.json pnpm-lock.yaml* ./
RUN pnpm install --frozen-lockfile || pnpm install
COPY . .
RUN pnpm prisma generate
RUN pnpm build

# ─────────────────────────────────────────────────────────────────────
# Prod — minimal runtime
# ─────────────────────────────────────────────────────────────────────
FROM base AS prod
ENV NODE_ENV=production
COPY --from=deps    /app/node_modules ./node_modules
COPY --from=builder /app/dist          ./dist
COPY --from=builder /app/prisma        ./prisma
COPY --from=builder /app/package.json  ./package.json
# Prisma client lives in node_modules/.prisma — copied via node_modules above
USER node
EXPOSE 3001
CMD ["node", "dist/main.js"]
