# Use Debian-based image for native module compatibility
FROM node:20-bookworm-slim AS builder

WORKDIR /app

# Install pnpm
RUN npm install -g pnpm

# Copy package files
COPY package.json pnpm-lock.yaml ./

# Install build tools for native modules
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*

# Install dependencies
RUN pnpm install --frozen-lockfile
RUN pnpm rebuild better-sqlite3

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

# Install build tools for native modules in runtime stage
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*

# Install all dependencies
RUN pnpm install --frozen-lockfile
RUN pnpm rebuild better-sqlite3

# Copy built frontend assets
COPY --from=builder /app/dist ./dist

# Copy backend code
COPY server.ts ./
COPY db.ts ./
COPY server ./server
COPY functions ./functions

# Expose server port
EXPOSE 8787

# Start Node.js server
# Environment variables are read directly by Node.js, no need for wrapper script
CMD ["npx", "tsx", "server.ts"]
