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

# Install pnpm
RUN npm install -g pnpm

# Copy package files
COPY package.json pnpm-lock.yaml ./

# Install all dependencies (including devDependencies to get tsx and types)
# In a rigorous setup we would build server.ts to js, but tsx is fine for this scale.
RUN pnpm install --frozen-lockfile

# Copy built frontend assets
COPY --from=builder /app/dist ./dist

# Copy backend code
COPY server.ts ./
COPY functions ./functions

# Expose server port
EXPOSE 8787

# Start Node.js server
# Environment variables are read directly by Node.js, no need for wrapper script
CMD ["npx", "tsx", "server.ts"]
