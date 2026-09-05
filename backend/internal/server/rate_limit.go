package server

import (
	"net"
	"net/http"
	"strings"
	"sync"
	"time"
)

// rateLimiter 简单的内存滑动窗口限流器（按 key，如客户端 IP）。
// 非持久化、单机有效，足以阻断脚本级暴力破解与批量注册。
type rateLimiter struct {
	mu       sync.Mutex
	window   time.Duration
	max      int
	requests map[string][]time.Time
	lastGC   time.Time
}

// newRateLimiter 构造限流器：window 时间窗内最多 max 次请求。
func newRateLimiter(window time.Duration, max int) *rateLimiter {
	return &rateLimiter{
		window:   window,
		max:      max,
		requests: map[string][]time.Time{},
		lastGC:   time.Now(),
	}
}

// allow 判断 key 当前是否允许请求；允许则记录本次。
func (l *rateLimiter) allow(key string) bool {
	now := time.Now()
	l.mu.Lock()
	defer l.mu.Unlock()

	// 定期清理过期记录，防止 map 无限增长。
	if now.Sub(l.lastGC) > l.window {
		cutoff := now.Add(-l.window)
		for k, ts := range l.requests {
			l.requests[k] = filterAfter(ts, cutoff)
			if len(l.requests[k]) == 0 {
				delete(l.requests, k)
			}
		}
		l.lastGC = now
	}

	cutoff := now.Add(-l.window)
	recent := filterAfter(l.requests[key], cutoff)
	if len(recent) >= l.max {
		l.requests[key] = recent
		return false
	}
	l.requests[key] = append(recent, now)
	return true
}

// filterAfter 返回 ts 中 >= cutoff 的记录（保持原顺序）。
func filterAfter(ts []time.Time, cutoff time.Time) []time.Time {
	out := ts[:0]
	for _, t := range ts {
		if !t.Before(cutoff) {
			out = append(out, t)
		}
	}
	return out
}

// clientIP 提取请求客户端 IP。
// 优先取 X-Forwarded-For 中最左的非私网地址（适配 Nginx/反代透传真实客户端），
// 仅当全部为私网地址或缺失时回退到 RemoteAddr。
// 注：若反代未清洗该头，客户端可伪造；对登录限流场景，伪造只会自伤其出口 IP。
func clientIP(r *http.Request) string {
	if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
		for _, hop := range strings.Split(xff, ",") {
			ip := net.ParseIP(strings.TrimSpace(hop))
			if ip == nil {
				continue
			}
			if !ip.IsPrivate() && !ip.IsLoopback() && !ip.IsLinkLocalUnicast() && !ip.IsUnspecified() {
				return ip.String()
			}
		}
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}

// rateLimit 挂载到登录/注册等公开敏感端点，返回 chi 中间件。
func (a *App) rateLimit(l *rateLimiter) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if !l.allow(clientIP(r)) {
				writeError(w, http.StatusTooManyRequests, "请求过于频繁，请稍后再试")
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}
