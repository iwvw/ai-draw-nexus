# syntax=docker/dockerfile:1

# ---- Stage 1: build frontend (drawio assets + vite dist) ----
FROM node:20-bookworm-slim AS frontend-builder

WORKDIR /app

# 仅拷贝 manifest，先行安装 npm 依赖以利用层缓存（源码变更不重跑 npm ci）
COPY package.json package-lock.json ./
# 安装构建工具（drawio:install 需 python3/tar 解压 .war）
RUN apt-get update && apt-get install -y --no-install-recommends python3 tar \
    && rm -rf /var/lib/apt/lists/* \
    && npm ci

# 拷贝源码（.dockerignore 已排除 node_modules/dist/public/vendor 等）
COPY . .

# 预置运行时数据目录（属主设为 distroless nonroot UID 65532，供 schema/db 落盘）
RUN mkdir -p /app/data && cp /app/data/schema.sql /app/schema.sql \
    && chown -R 65532:65532 /app/data /app/schema.sql

# 下载并解压自部署 draw.io 到 public/vendor/drawio。
# war 包缓存到 /app/.tmp，二次构建不再重复下载 71MB。
RUN --mount=type=cache,target=/app/.tmp \
    mkdir -p public/vendor && npm run drawio:install

# 构建前端产物 dist（含 draw.io 静态资源与 PWA）
RUN npm run build

# ---- Stage 2: build Go backend (CGO_ENABLED=0 静态链接，含 modernc sqlite) ----
FROM golang:1.26-bookworm AS go-builder

WORKDIR /src

# 仅拷贝依赖清单，先行预下载以复用 Go module 缓存（源码变更不重跑）
COPY backend/go.mod backend/go.sum ./
RUN --mount=type=cache,target=/go/pkg/mod \
    go mod download

COPY backend ./backend
WORKDIR /src/backend
RUN --mount=type=cache,target=/go/pkg/mod \
    --mount=type=cache,target=/root/.cache/go-build \
    CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/nexus-server ./cmd/server

# ---- Stage 3: runtime ----
# Go 静态二进制 + modernc sqlite（纯 Go，无 cgo），用 distroless 精简运行时。
# distroless nonroot UID=65532，无 shell 无法 RUN chmod，故 data/ 与 schema 已在前端
# 阶段以 65532 属主整体 COPY，保证可写 /app/data（nexus.db、.dev.secret 均落于此）。
FROM gcr.io/distroless/static-debian12:nonroot

WORKDIR /app

# 前端静态产物 + Go 二进制 + schema（全部 --chown=65532 保证 nonroot 可读写）
COPY --from=frontend-builder --chown=65532:65532 /app/dist ./dist
COPY --from=go-builder --chown=65532:65532 /out/nexus-server ./nexus-server
COPY --from=frontend-builder --chown=65532:65532 /app/data ./data
COPY --from=frontend-builder --chown=65532:65532 /app/schema.sql ./schema.sql

# distroless 无 shell、nonroot 仅 /app/data 可写：把 JWT dev secret 指到该目录
ENV JWT_SECRET_FILE=/app/data/.dev.secret
# 生产环境：config.Load 会强制要求显式 JWT_SECRET（避免多副本各自生成随机密钥
# 导致负载均衡下登录态互相失效）；部署时须注入 JWT_SECRET 环境变量。
ENV NODE_ENV=production

EXPOSE 8787

CMD ["./nexus-server"]
