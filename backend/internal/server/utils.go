package server

import (
	"encoding/json"
	"path"
	"regexp"
	"strings"
	"unicode/utf8"
)

var importableExtRe = regexp.MustCompile(`(?i)\.(mmd|mermaid|excalidraw|drawio|xml|json|txt)$`)

// truncateStr 截断字符串到 n 个字符（rune），用于审计 metadata 等短字段。
func truncateStr(s string, n int) string {
	if utf8.RuneCountInString(s) <= n {
		return s
	}
	return string([]rune(s)[:n])
}

func importableExt(filename string) bool {
	return importableExtRe.MatchString(filename)
}

// pathExt 返回小写扩展名（含点），无则空串。
func pathExt(filename string) string {
	base := path.Base(filename)
	idx := strings.LastIndexByte(base, '.')
	if idx < 0 {
		return ""
	}
	return base[idx:]
}

func inferEngine(content, filename string) string {
	name := strings.ToLower(filename)
	switch {
	case strings.HasSuffix(name, ".mmd") || strings.HasSuffix(name, ".mermaid"):
		return "mermaid"
	case strings.HasSuffix(name, ".excalidraw"):
		return "excalidraw"
	case strings.HasSuffix(name, ".drawio") || strings.HasSuffix(name, ".xml"):
		return "drawio"
	}
	trimmed := strings.TrimLeft(content, " \t\r\n")
	if strings.HasPrefix(trimmed, "<mxGraphModel") || strings.HasPrefix(trimmed, "<mxfile") {
		return "drawio"
	}
	if strings.HasPrefix(trimmed, "{") {
		var parsed struct {
			Type     string          `json:"type"`
			Elements json.RawMessage `json:"elements"`
		}
		if err := json.Unmarshal([]byte(trimmed), &parsed); err == nil {
			if parsed.Type == "excalidraw" || len(parsed.Elements) > 0 {
				return "excalidraw"
			}
		}
	}
	return "mermaid"
}