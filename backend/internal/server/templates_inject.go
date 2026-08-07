package server

import (
	"fmt"
	"regexp"
	"strings"

	"ai-draw-nexus/internal/ai"
	"ai-draw-nexus/internal/db"
	"ai-draw-nexus/internal/gen"
)

// templateRefRE 匹配用户提示词中对模板编号的显式引用，如 @T01 / @tech-roadmap。
var templateRefRE = regexp.MustCompile(`@([A-Za-z0-9][A-Za-z0-9_-]{0,31})`)

// visibleTemplates 返回用户可见模板（供清单注入与编号解析）。
func (a *App) visibleTemplates(userID string) ([]db.Template, error) {
	list, err := a.Store.ListVisibleTemplates(userID)
	if err != nil {
		return nil, err
	}
	return list, nil
}

// findTemplateByCode 按编号在可见模板中查找（忽略大小写）。
func findTemplateByCode(list []db.Template, code string) *db.Template {
	code = strings.ToLower(code)
	for i := range list {
		if strings.ToLower(list[i].Code) == code {
			return &list[i]
		}
	}
	return nil
}

// templateSystemBlurb 生成注入 system prompt 的「可用模板清单」文本，
// 让 LLM 能识别 @编号 并参考模板结构。
func templateSystemBlurb(list []db.Template, engine string) string {
	var visible []db.Template
	for _, t := range list {
		if t.EngineType != engine {
			continue
		}
		visible = append(visible, t)
	}
	if len(visible) == 0 {
		return ""
	}
	var sb strings.Builder
	sb.WriteString("\n\n## 可用模板库\n可引用模板编号（在用户请求中写 `@编号` 触发），或参考其结构：\n")
	for _, t := range visible {
		typ := "提示词"
		if t.Type == "skeleton" {
			typ = "骨架代码"
		}
		sb.WriteString(fmt.Sprintf("- %s @%s 「%s」(%s) — %s\n", typ, t.Code, t.Name, t.EngineType, t.Description))
	}
	return sb.String()
}

// templateUserBlock 生成注入 user content 的模板说明（当用户显式引用某模板时）。
func templateUserBlock(t *db.Template) string {
	if t == nil {
		return ""
	}
	kind := "提示词模板"
	if t.Type == "skeleton" {
		kind = "骨架代码模板"
	}
	return fmt.Sprintf("\n\n--- 已引用模板 %s 「%s」(@%s) ---\n%s\n%s",
		kind, t.Name, t.Code, t.Description, t.Content)
}

// resolvePromptTemplates 从用户提示词中解析显式引用的模板，返回：
//   - 注入 system 的清单文本
//   - 追加到 user 内容的模板块
//   - 去掉 @ 编号后的干净提示词
func (a *App) resolvePromptTemplates(userID, prompt, engine string) (systemExtra string, userExtra string, cleanPrompt string) {
	list, err := a.visibleTemplates(userID)
	if err != nil {
		return "", "", prompt
	}
	systemExtra = templateSystemBlurb(list, engine)
	cleanPrompt = prompt
	seen := map[string]bool{}
	for _, m := range templateRefRE.FindAllStringSubmatch(prompt, -1) {
		code := m[1]
		if seen[code] {
			continue
		}
		if t := findTemplateByCode(list, code); t != nil {
			seen[code] = true
			userExtra += templateUserBlock(t)
			cleanPrompt = strings.ReplaceAll(cleanPrompt, "@"+code, "")
		}
	}
	return systemExtra, userExtra, strings.TrimSpace(cleanPrompt)
}

// mergeGenMessages 组合 system + 模板清单 + user 内容（含模板引用与多模态图片）。
// images 为 base64 dataURL 数组；非空时 user 消息使用多模态 Content 数组。
func (a *App) mergeGenMessages(userID, engine, prompt, currentContent string, images []string) []ai.Message {
	sysExtra, userExtra, cleanPrompt := a.resolvePromptTemplates(userID, prompt, engine)
	userMsg := gen.UserContent(cleanPrompt, currentContent)
	if userExtra != "" {
		userMsg += userExtra
	}

	systemContent := gen.SystemPrompt(engine) + sysExtra
	var userContent any = userMsg

	// 多模态：图片 base64 作为 image_url 内容块，与文本并存。
	if n := len(images); n > 0 {
		parts := []any{
			map[string]any{"type": "text", "text": userContent.(string)},
		}
		for _, img := range images {
			if img == "" {
				continue
			}
			parts = append(parts, map[string]any{
				"type": "image_url",
				"image_url": map[string]any{"url": img},
			})
		}
		userContent = parts
	}

	return []ai.Message{
		{Role: "system", Content: systemContent},
		{Role: "user", Content: userContent},
	}
}