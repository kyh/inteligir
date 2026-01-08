FROM imbios/bun-node:22-alpine AS base

# Install Chromium and dependencies
RUN apk add --no-cache \
    chromium \
    nss \
    harfbuzz \
    ca-certificates \
    font-inter \
    font-jetbrains-mono \
    font-noto-emoji \
    font-dejavu \
    ttf-liberation \
    ttf-opensans \
    font-noto \
    msttcorefonts-installer \
    fontconfig \
    openssl \
    && update-ms-fonts \
    && fc-cache -f

# Set Chrome executable path
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser

# Install dependencies only when needed
FROM base AS deps
WORKDIR /app

# Copy package files
COPY package.json bun.lock* ./
COPY prisma ./prisma
RUN bun install --frozen-lockfile --ignore-scripts

FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production

# Generate Prisma client
RUN bunx prisma generate

# Build Next.js application
RUN bun run build

# Deploy Prisma migrations
RUN bunx prisma migrate deploy

# Production image, copy all the files and run next
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser

RUN addgroup --system nodejs 2>/dev/null || true
RUN adduser --system --ingroup nodejs nextjs 2>/dev/null || true

# Copy necessary files
COPY --from=builder /app/public ./public

# Set the correct permission for prerender cache
RUN mkdir .next
RUN chown nextjs:nodejs .next

# Copy build output
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# Copy Prisma generated clients, schemas, and config
COPY --from=builder --chown=nextjs:nodejs /app/generated ./generated
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/@prisma ./node_modules/@prisma
COPY --from=builder --chown=nextjs:nodejs /app/prisma ./prisma
COPY --from=builder --chown=nextjs:nodejs /app/prisma.config.ts ./prisma.config.ts

# Copy YJS server code and dependencies
COPY --from=builder --chown=nextjs:nodejs /app/src ./src
COPY --from=builder --chown=nextjs:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=nextjs:nodejs /app/package.json ./package.json
COPY --from=builder --chown=nextjs:nodejs /app/tsconfig.json ./tsconfig.json

# Create startup script
RUN echo '#!/bin/sh' > /app/start.sh && \
    echo 'set -e' >> /app/start.sh && \
    echo 'echo "Starting YJS collaboration server..."' >> /app/start.sh && \
    echo 'bun run src/server/yjs/server.ts &' >> /app/start.sh && \
    echo 'echo "Starting Next.js application..."' >> /app/start.sh && \
    echo 'exec node server.js' >> /app/start.sh && \
    chmod +x /app/start.sh && \
    chown nextjs:nodejs /app/start.sh

USER nextjs

# Expose Next.js port and YJS WebSocket port
EXPOSE 3000 4444

ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

# Use startup script to run both Next.js and YJS server
CMD ["/app/start.sh"]
