# Use Debian-based image for compatibility with Cloudflare workerd
FROM node:20-bookworm-slim AS builder

WORKDIR /app

# Install pnpm
RUN npm install -g pnpm

# Copy package files
COPY package.json pnpm-lock.yaml ./

# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy source code
COPY . .

# Build the project (produces 'dist' folder)
RUN pnpm run build

# Runtime stage
FROM node:20-bookworm-slim

WORKDIR /app

# Install dependencies needed for running wrangler/runtime
# We only need wrangler to serve the app
RUN npm install -g wrangler

# Copy built assets and functions
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/functions ./functions
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/scripts/docker-entrypoint.sh ./docker-entrypoint.sh

# Make entrypoint executable
RUN chmod +x docker-entrypoint.sh

# Expose the port wrangler will run on
EXPOSE 8787

# Use entrypoint script to setup env vars
ENTRYPOINT ["./docker-entrypoint.sh"]

# Run wrangler pages dev logic
# --ip 0.0.0.0 to allow external access
# --port 8787
# --no-live-reload for "production" feel
CMD ["npx", "wrangler", "pages", "dev", "dist", "--ip", "0.0.0.0", "--port", "8787", "--no-live-reload"]
