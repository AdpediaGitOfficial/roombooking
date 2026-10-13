# syntax=docker/dockerfile:1
# Production image for the Staff Accommodation Management app.
#
#   build  – full toolchain; also used by the `migrate` compose service
#            (prisma migrate deploy, db:seed) because the CLI is not part of
#            the runtime image.
#   runner – Next.js standalone server as the unprivileged `node` user.
#
# Debian (not Alpine) so the Prisma query engine generated for
# debian-openssl-3.0.x is the one that ships in the image.

FROM node:22-bookworm-slim AS base
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

FROM base AS deps
COPY package.json package-lock.json ./
COPY prisma ./prisma
# postinstall runs `prisma generate`, which only needs the schema.
RUN npm ci

FROM deps AS build
COPY . .
# `next build` does not touch the database: every page renders its data
# inside Suspense boundaries, so no DATABASE_URL is needed here.
RUN npm run build

FROM base AS runner
ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    UPLOAD_DIR=/app/uploads
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/public ./public
RUN mkdir -p /app/uploads && chown node:node /app/uploads
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + process.env.PORT + '/api/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
CMD ["node", "server.js"]
