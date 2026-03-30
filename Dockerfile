# Stage 1: Build
FROM node:20-slim AS builder
WORKDIR /app

# Install build dependencies (tsx, vite, esbuild are devDependencies)
COPY package.json package-lock.json ./
RUN npm ci

# Copy source and build
COPY . .
RUN npm run build

# Stage 2: Production
FROM node:20-slim AS production
WORKDIR /app

# Copy built artifacts (includes dist/index.cjs + dist/public/ frontend assets)
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/package-lock.json ./package-lock.json

# Install production dependencies only (runtime deps not bundled by esbuild)
RUN npm ci --omit=dev

# Set environment
ENV NODE_ENV=production
ENV PORT=5000
EXPOSE 5000

# Health check using /api/health endpoint
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://localhost:5000/api/health').then(r => r.ok ? process.exit(0) : process.exit(1)).catch(() => process.exit(1))"

# Run as non-root for security
USER node

CMD ["node", "dist/index.cjs"]
