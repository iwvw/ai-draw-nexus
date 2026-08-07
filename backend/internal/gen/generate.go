// Package gen 提供图表生成逻辑（对齐 TS server/ai/generate.ts）。
package gen

import (
	"context"
	"regexp"
	"strings"

	"ai-draw-nexus/internal/ai"
)

// GenerateOptions 生成请求选项。
type GenerateOptions struct {
	Prompt         string
	EngineType     string
	CurrentContent string
}

// GenerateResult 生成结果。
type GenerateResult struct {
	Content    string `json:"content"`
	EngineType string `json:"engineType"`
}

var codeBlockPatterns = map[string][]*regexp.Regexp{
	"mermaid":     {regexp.MustCompile("(?i)```mermaid\\n?([\\s\\S]*?)```"), regexp.MustCompile("(?i)```\\n?([\\s\\S]*?)```")},
	"drawio":      {regexp.MustCompile("(?i)```xml\\n?([\\s\\S]*?)```"), regexp.MustCompile("(?i)```\\n?([\\s\\S]*?)```")},
	"excalidraw":  {regexp.MustCompile("(?i)```json\\n?([\\s\\S]*?)```"), regexp.MustCompile("(?i)```\\n?([\\s\\S]*?)```")},
}

// ExtractCode 剥离 Markdown 代码块，取引擎对应块。
func ExtractCode(response, engineType string) string {
	code := strings.TrimSpace(response)
	patterns := codeBlockPatterns[engineType]
	if patterns == nil {
		patterns = codeBlockPatterns["drawio"]
	}
	for _, re := range patterns {
		if m := re.FindStringSubmatch(code); m != nil && len(m) > 1 {
			return strings.TrimSpace(m[1])
		}
	}
	return code
}

// Generate 非流式生成图表。
func Generate(ctx context.Context, messages []ai.Message, env ai.EffectiveEnv, engineType string) (GenerateResult, error) {
	raw, err := ai.Call(ctx, messages, env)
	if err != nil {
		return GenerateResult{}, err
	}
	content := ExtractCode(raw, engineType)
	if engineType == "mermaid" {
		content = normalizeMermaid(content)
	}
	return GenerateResult{Content: content, EngineType: engineType}, nil
}

// UserContent 构造用户消息（含当前内容编辑或全新生成）。
func UserContent(prompt, currentContent string) string {
	if currentContent != "" {
		return `当前图表内容：
"""
` + currentContent + `"""

用户修改请求："""` + prompt + `"""

根据用户修改请求进行修改，同时尽量保持原有结构不变。输出完整的修改后的图表代码。`
	}
	return `用户需求：
"""
` + prompt + `"""

根据以上需求，生成完整的图表代码。`
}

// SystemPrompt 返回引擎对应的系统提示词。
func SystemPrompt(engineType string) string {
	switch engineType {
	case "mermaid":
		return mermaidPrompt
	case "excalidraw":
		return excalidrawPrompt
	default:
		return drawioPrompt
	}
}