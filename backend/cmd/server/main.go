// Package main 是 Go 后端入口，替代原 Node+Hono server。
package main

import (
	"log"
	"net/http"
	"os"
	"path/filepath"

	"ai-draw-nexus/internal/auth"
	"ai-draw-nexus/internal/config"
	"ai-draw-nexus/internal/db"
	"ai-draw-nexus/internal/server"
)

// schemaPath 定位 schema.sql：优先 SCHEMA_PATH 环境变量，
// 其次程序运行目录（backend/）向上两层到仓库根 data/schema.sql。
func schemaPath(cfg *config.Config) string {
	if v := os.Getenv("SCHEMA_PATH"); v != "" {
		return v
	}
	if cfg.DBPath != "" {
		return filepath.Join(filepath.Dir(cfg.DBPath), "schema.sql")
	}
	candidates := []string{
		filepath.Join("..", "data", "schema.sql"), // 从 backend/ 到仓库根
		filepath.Join("data", "schema.sql"),        // 从仓库根
		"schema.sql",
	}
	for _, c := range candidates {
		if info, err := os.Stat(c); err == nil && !info.IsDir() {
			return c
		}
	}
	return filepath.Join("data", "schema.sql")
}

func main() {
	cfg, err := config.Load()
	if err != nil {
		log.Fatalf("配置加载失败: %v", err)
	}

	store, err := db.Open(cfg.DBPath, schemaPath(cfg))
	if err != nil {
		log.Fatalf("数据库打开失败: %v", err)
	}
	defer store.Close()
	if err := store.Init(); err != nil {
		log.Fatalf("数据库初始化失败: %v", err)
	}

	app := server.New(store, auth.NewJWTService(cfg.JWTSecret), cfg)
	handler := app.Routes()

	addr := ":" + cfg.Port
	log.Printf("AI Draw Nexus (Go) 服务启动于 %s", addr)
	if err := http.ListenAndServe(addr, handler); err != nil {
		log.Fatal(err)
	}
}