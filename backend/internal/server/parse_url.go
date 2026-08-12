package server

import (
	"context"
	"errors"
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

// parseURLTransport 抓取 Transport：连接时解析并逐一校验解析出的所有 IP，
// 然后直接连接校验通过的 IP，杜绝 DNS rebinding 绕过私网检查。
var parseURLTransport = &http.Transport{
	DialContext: func(ctx context.Context, network, addr string) (net.Conn, error) {
		host, port, err := net.SplitHostPort(addr)
		if err != nil {
			return nil, err
		}
		if err := validateDialHost(host); err != nil {
			return nil, err
		}
		ips, err := net.LookupIP(host)
		if err != nil {
			return nil, errors.New("不允许访问内网地址")
		}
		var dst net.IP
		for _, ip := range ips {
			if ip.IsPrivate() || ip.IsLoopback() || ip.IsLinkLocalUnicast() || ip.IsUnspecified() {
				return nil, errors.New("不允许访问内网地址")
			}
			if dst == nil {
				dst = ip
			}
		}
		if dst == nil {
			return nil, errors.New("不允许访问内网地址")
		}
		// 直接连已校验的 IP，避免连接阶段二次解析被劫持到内网。
		d := &net.Dialer{Timeout: 10 * time.Second, KeepAlive: 30 * time.Second}
		return d.DialContext(ctx, network, net.JoinHostPort(dst.String(), port))
	},
}

// validateDialHost 校验主机名是否为私网/本机地址。
func validateDialHost(host string) error {
	if h, _, err := net.SplitHostPort(host); err == nil {
		host = h
	}
	ip := net.ParseIP(host)
	if ip == nil {
		if isPrivateHostname(host) {
			return errors.New("不允许访问内网地址")
		}
		return nil
	}
	if ip.IsPrivate() || ip.IsLoopback() || ip.IsLinkLocalUnicast() || ip.IsUnspecified() {
		return errors.New("不允许访问内网地址")
	}
	return nil
}

// parseURLClient 抓取客户端（20s 超时）。
// CheckRedirect 在每一跳都重新校验目标主机，防止 30x 重定向绕过私网检查（SSRF）。
var parseURLClient = &http.Client{
	Transport:   parseURLTransport,
	Timeout:     20 * time.Second,
	CheckRedirect: func(req *http.Request, via []*http.Request) error {
		if len(via) >= 5 {
			return errors.New("重定向次数过多")
		}
		if isPrivateHostname(req.URL.Hostname()) {
			return errors.New("不允许访问内网地址")
		}
		return nil
	},
}

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