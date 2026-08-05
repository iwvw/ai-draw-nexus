# Use Debian-based image for native module compatibility
FROM node:20-bookworm-slim AS builder

WORKDIR /app

# Copy package files
COPY package.json package-lock.json ./

# Install build tools for native modules
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*

# Install dependencies
RUN npm ci
RUN npm rebuild better-sqlite3

# Copy source code
COPY . .

# Build the project (produces 'dist' folder)
RUN npm run build

# Runtime stage
FROM node:20-bookworm-slim

WORKDIR /app

# Copy package files
COPY package.json package-lock.json ./

# Install build tools for native modules in runtime stage
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*

# Install all dependencies
RUN npm ci
RUN npm rebuild better-sqlite3

# Copy built frontend assets
COPY --from=builder /app/dist ./dist

# Copy backend code
COPY server.ts ./
COPY server ./server
COPY data/schema.sql ./data/schema.sql
# Backup copy so initDb can fall back when a host volume shadows data/
COPY data/schema.sql ./schema.sql

# Expose server port
EXPOSE 8787

# Start Node.js server
# Environment variables are read directly by Node.js, no need for wrapper script
CMD ["npx", "tsx", "server.ts"]
