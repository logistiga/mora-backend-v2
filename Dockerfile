# syntax=docker/dockerfile:1

# ---------- deps: install once, reused by build ----------
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --legacy-peer-deps

# ---------- build: compile TS + generate Prisma client ----------
FROM node:22-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate
RUN npm run build

# ---------- prod-deps: production-only node_modules ----------
FROM node:22-alpine AS prod-deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --legacy-peer-deps

# ---------- runtime: minimal final image ----------
FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup -S mora && adduser -S mora -G mora

COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
COPY prisma ./prisma

# Upload storage is a mount point at runtime; create it owned by the runtime
# user so a fresh named volume inherits that ownership and stays writable.
RUN mkdir -p /app/storage/documents && chown -R mora:mora /app/storage

USER mora
EXPOSE 3000

CMD ["node", "dist/main.js"]
