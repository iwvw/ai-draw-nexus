package ai

import (
	"context"
	"errors"
	"net"
	"net/http"
	"strings"
	"time"
)

// isPrivateHostname 判断主机名是否指向私有/本机地址（SSRF 防护）。
// 与 server/parse_url.go 的校验逻辑保持一致。
func isPrivateHostname(host string) bool {
	if h, _, err := net.SplitHostPort(host); err == nil {
		host = h
	}
	if strings.EqualFold(host, "localhost") || strings.HasSuffix(strings.ToLower(host), ".local") {
		return true
	}
	ip := net.ParseIP(host)
	if ip == nil {
		addrs, err := net.LookupIP(host)
		if err != nil {
			return true
		}
		ip = addrs[0]
	}
	if ip == nil {
		return true
	}
	return ip.IsPrivate() || ip.IsLoopback() || ip.IsLinkLocalUnicast() || ip.IsUnspecified()
}

// safeTransport 抓取 Transport：连接时解析并逐一校验所有 IP，直连已校验 IP，
// 杜绝 DNS rebinding 绕过私网检查（SSRF 防护，覆盖用户可控 baseUrl）。
var safeTransport = &http.Transport{
	DialContext: func(ctx context.Context, network, addr string) (net.Conn, error) {
		host, port, err := net.SplitHostPort(addr)
		if err != nil {
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
		d := &net.Dialer{Timeout: 10 * time.Second, KeepAlive: 30 * time.Second}
		return d.DialContext(ctx, network, net.JoinHostPort(dst.String(), port))
	},
}

// httpClient 非流式调用客户端：带 SSRF 防护 transport + 5min 总超时。
// CheckRedirect 在每一跳重新校验目标主机，防止 30x 重定向绕过私网检查（SSRF）。
var httpClient = &http.Client{Timeout: 5 * time.Minute, Transport: safeTransport, CheckRedirect: checkRedirect}

// streamClient 流式调用客户端：带 SSRF 防护 transport，总超时放宽到 15min，
// 避免长 SSE 流（max_tokens 大、模型慢）在 5min 被强制断开。
var streamClient = &http.Client{Timeout: 15 * time.Minute, Transport: safeTransport, CheckRedirect: checkRedirect}

// checkRedirect 在每一跳重新校验目标主机，防止 30x 重定向绕过私网检查。
func checkRedirect(req *http.Request, via []*http.Request) error {
	if len(via) >= 5 {
		return errors.New("重定向次数过多")
	}
	if isPrivateHostname(req.URL.Hostname()) {
		return errors.New("不允许访问内网地址")
	}
	return nil
}
