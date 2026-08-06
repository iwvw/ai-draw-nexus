package mcp

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"strings"
)

func shaHex(s string) string {
	sum := sha256.Sum256([]byte(s))
	return hex.EncodeToString(sum[:])
}

// inferEngine 对标 TS inferEngine。
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