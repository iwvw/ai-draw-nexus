package server

import (
	"net/http"
	"os"
	"path/filepath"
	"strings"
)

// fileServer 兜底托管前端 dist（含 draw.io 静态与 SPA fallback），并放行 API/WS/mcp。
func (a *App) fileServer(next http.Handler) http.Handler {
	root := a.Cfg.DistDir
	if root == "" {
		root = "./dist"
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, "/api/") || r.URL.Path == "/mcp" ||
			r.URL.Path == "/ai-prompt.txt" || r.URL.Path == "/api/collab" {
			next.ServeHTTP(w, r)
			return
		}
		if strings.HasPrefix(r.URL.Path, "/vendor/drawio/") {
			w.Header().Set("Content-Security-Policy", "frame-ancestors 'self'")
		}
		clean := filepath.Clean(r.URL.Path)
		p := filepath.Join(root, clean)
		if clean == "/" || clean == "" || clean == "." {
			p = filepath.Join(root, "index.html")
		}
		info, statErr := os.Stat(p)
		if statErr == nil && info.IsDir() {
			idx := filepath.Join(p, "index.html")
			if _, err := os.Stat(idx); err == nil {
				http.ServeFile(w, r, idx)
				return
			}
			http.ServeFile(w, r, p)
			return
		}
		if statErr == nil && !info.IsDir() {
			http.ServeFile(w, r, p)
			return
		}
		// SPA fallback
		http.ServeFile(w, r, filepath.Join(root, "index.html"))
	})
}