package server

import (
	"io"
	"net"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"time"
)

type parseURLReq struct {
	URL string `json:"url"`
}

var (
	reTitle = regexp.MustCompile(`(?is)<title[^>]*>(.*?)</title>`)
	reScript = regexp.MustCompile(`(?is)<script[^>]*>.*?</script>`)
	reStyle  = regexp.MustCompile(`(?is)<style[^>]*>.*?</style>`)
	reTag    = regexp.MustCompile(`(?i)<[^>]+>`)
	reSpace  = regexp.MustCompile(`[ \t\r\n\f]+`)
)

// isPrivateHostname 判断主机名是否指向私有/本机地址（SSRF 防护）。
func isPrivateHostname(host string) bool {
	// 去掉端口
	if h, _, err := net.SplitHostPort(host); err == nil {
		host = h
	}
	if strings.EqualFold(host, "localhost") || strings.HasSuffix(strings.ToLower(host), ".local") {
		return true
	}
	ip := net.ParseIP(host)
	if ip == nil {
		// 可能是域名，尝试解析
		addrs, err := net.LookupIP(host)
		if err != nil {
			return true // 无法解析视为不安全
		}
		ip = addrs[0]
	}
	if ip == nil {
		return true
	}
	return ip.IsPrivate() || ip.IsLoopback() || ip.IsLinkLocalUnicast() || ip.IsUnspecified()
}

// parseURLClient 抓取客户端（20s 超时）。
var parseURLClient = &http.Client{Timeout: 20 * time.Second}

// handleParseURL POST /api/parse-url/
func (a *App) handleParseURL(w http.ResponseWriter, r *http.Request) {
	var body parseURLReq
	if err := decodeBody(r, &body); err != nil || body.URL == "" {
		writeError(w, http.StatusBadRequest, "请提供有效的URL")
		return
	}
	u, err := url.Parse(body.URL)
	if err != nil || u.Scheme == "" || u.Host == "" {
		writeError(w, http.StatusBadRequest, "URL格式无效")
		return
	}
	if u.Scheme != "http" && u.Scheme != "https" {
		writeError(w, http.StatusBadRequest, "URL格式无效")
		return
	}
	if u.User != nil {
		writeError(w, http.StatusBadRequest, "URL格式无效")
		return
	}
	if isPrivateHostname(u.Hostname()) {
		writeError(w, http.StatusBadRequest, "URL格式无效")
		return
	}

	req, err := http.NewRequestWithContext(r.Context(), "GET", u.String(), nil)
	if err != nil {
		writeError(w, http.StatusBadRequest, "URL格式无效")
		return
	}
	req.Header.Set("User-Agent", "Mozilla/5.0 (compatible; AI-Draw-Nexus/1.0)")
	if strings.Contains(strings.ToLower(u.Host), "mp.weixin.qq.com") {
		req.Header.Set("Referer", "https://mp.weixin.qq.com/")
	}
	resp, err := parseURLClient.Do(req)
	if err != nil {
		writeError(w, http.StatusBadGateway, "无法获取页面内容")
		return
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		writeError(w, http.StatusBadGateway, "无法获取页面内容: "+strconv.Itoa(resp.StatusCode))
		return
	}
	raw, _ := io.ReadAll(io.LimitReader(resp.Body, 2<<20))
	htmlText := string(raw)

	title := ""
	if m := reTitle.FindStringSubmatch(htmlText); m != nil && len(m) > 1 {
		title = strings.TrimSpace(stripHTML(m[1]))
	}
	if title == "" {
		title = u.Hostname()
	}

	bodyText := reScript.ReplaceAllString(htmlText, "")
	bodyText = reStyle.ReplaceAllString(bodyText, "")
	bodyText = reTag.ReplaceAllString(bodyText, " ")
	bodyText = reSpace.ReplaceAllString(bodyText, " ")
	bodyText = strings.TrimSpace(bodyText)
	if len(bodyText) > 10000 {
		bodyText = bodyText[:10000] + "..."
	}

	excerpt := bodyText
	if len(excerpt) > 200 {
		excerpt = excerpt[:200]
	}
	siteName := u.Hostname()
	if strings.Contains(strings.ToLower(u.Host), "mp.weixin.qq.com") {
		siteName = "微信公众号"
	}
	content := "# " + title + "\n\n> 来源: [" + siteName + "](" + body.URL + ")\n\n" + bodyText

	writeJSON(w, http.StatusOK, map[string]any{"success": true, "data": map[string]any{
		"title": title, "content": content, "excerpt": excerpt,
		"siteName": siteName, "url": body.URL,
	}})
}

func extractTitle(s string) string { return strings.TrimSpace(s) }

func stripHTML(s string) string {
	return reTag.ReplaceAllString(s, " ")
}