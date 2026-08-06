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

// schemaPath 定位 schema.sql：
// 优先 SCHEMA_PATH 环境变量，其次 DBPath 所在目录，最后向上查找仓库根。
func schemaPath(cfg *config.Config) string {
	if v := os.Getenv("SCHEMA_PATH"); v != "" {
		return v
	}
	if cfg.DBPath != "" {
		return filepath.Join(filepath.Dir(cfg.DBPath), "schema.sql")
	}
	return filepath.Join("data", "schema.sql")
}

// resolveRuntimePaths 当程序从 backend/ 子目录运行（npm run dev:backend-go）时，
// 把 data/ 与 dist/ 指向仓库根，保证 DB、schema、前端静态、drawio 路径一致。
func resolveRuntimePaths(cfg *config.Config) {
	root := findRootDir()
	if root == "" || filepath.IsAbs(cfg.DBPath) {
		return
	}
	// 若 cwd 下没有 data/ 或 dist/，但仓库根有，则改用仓库根路径
	if !dirExists("data") && dirExists(filepath.Join(root, "data")) {
		if cfg.DBPath == "data/nexus.db" {
			cfg.DBPath = filepath.Join(root, "data", "nexus.db")
		}
	}
	if cfg.DistDir == "./dist" && !dirExists("dist") && dirExists(filepath.Join(root, "dist")) {
		cfg.DistDir = filepath.Join(root, "dist")
	}
}

// findRootDir 向上查找含 data/schema.sql 的仓库根。
func findRootDir() string {
	wd, err := os.Getwd()
	if err != nil {
		return ""
	}
	for dir := wd; ; dir = filepath.Dir(dir) {
		if fileExists(filepath.Join(dir, "data", "schema.sql")) {
			return dir
		}
		if dir == filepath.Dir(dir) {
			return ""
		}
	}
}

func dirExists(p string) bool {
	info, err := os.Stat(p)
	return err == nil && info.IsDir()
}

func fileExists(p string) bool {
	info, err := os.Stat(p)
	return err == nil && !info.IsDir()
}

func main() {
	cfg, err := config.Load()
	if err != nil {
		log.Fatalf("配置加载失败: %v", err)
	}
	resolveRuntimePaths(cfg)

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
	log.Printf("AI Draw Nexus (Go) 服务启动于 %s (db=%s)", addr, cfg.DBPath)
	if err := http.ListenAndServe(addr, handler); err != nil {
		log.Fatal(err)
	}
}