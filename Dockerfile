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
# Go 静态二进制 + modernc sqlite（纯 Go，无 cgo），用 distroless 精简运行时
FROM gcr.io/distroless/static-debian12:nonroot

WORKDIR /app

# 拷贝前端静态产物（dist 内已含 public/vendor/drawio）
COPY --from=frontend-builder /app/dist ./dist
# 拷贝 Go 二进制
COPY --from=go-builder /out/nexus-server ./nexus-server
# schema 供初始化使用（distroless nonroot 默认 uid 为 65532）
COPY --chown=65532:65532 data/schema.sql ./data/schema.sql
COPY --chown=65532:65532 data/schema.sql ./schema.sql

# 可写数据目录（.dev.secret、nexus.db 均落于此；distroless 无 shell，用 COPY 预创建）
COPY --chown=65532:65532 data/schema.sql ./data/.keep

EXPOSE 8787

CMD ["./nexus-server"]
