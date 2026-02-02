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

# Copy public folder if needed (usually included in dist by vite build, but functions might rely on other things?) 
# Vite build puts public into dist.

# Expose the port wrangler will run on
EXPOSE 8787

# Environment variables should be passed at runtime using -e flags in docker run
# or defined in a .dev.vars file mounted to /app/.dev.vars

# Run wrangler pages dev logic
# --ip 0.0.0.0 to allow external access
# --port 8787
# --no-live-reload for "production" feel
CMD ["npx", "wrangler", "pages", "dev", "dist", "--ip", "0.0.0.0", "--port", "8787", "--no-live-reload"]
