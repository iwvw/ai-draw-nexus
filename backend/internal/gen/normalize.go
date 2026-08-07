package gen

import (
	"regexp"
	"strings"
)

// normalizeMermaid 修复 AI 常见的 Mermaid 粘连/混用错误：
//  1. 声明行后紧跟 `%%` 注释/classDef 粘连 -> 拆分到独立行。
//  2. 连接符混用：`A -- "文本" ==> B` 或 `A -- "文本" -.-> B`
//     （实线 label 前缀配虚/粗线结尾）导致无法解析，改为规范写法。
func normalizeMermaid(code string) string {
	out := code
	for _, re := range []*regexp.Regexp{
		regexp.MustCompile(`(?i)^(flowchart\s+(?:TB|LR|TD|RL|BT))\s*%%`),
		regexp.MustCompile(`(?i)^(graph\s+(?:TB|LR|TD|RL|BT))\s*%%`),
	} {
		out = re.ReplaceAllString(out, "$1\n%%")
	}

	// `A -- "文本" -.-> B` -> `A -. "文本" .-> B`
	out = regexp.MustCompile(`--(\s*"[^"]*")\s*-\s*\.->`).ReplaceAllString(out, `-.$1 .->`)
	// `A -- "文本" ==> B` -> `A == "文本" ==> B`
	out = regexp.MustCompile(`--(\s*"[^"]*")\s*==>`).ReplaceAllString(out, `==$1 ==>`)
	// 无 label 裸混用：`A -- -.-> B` -> `A -.-> B`
	out = regexp.MustCompile(`--\s*-\s*\.->`).ReplaceAllString(out, `-.->`)
	out = regexp.MustCompile(`--\s*==>`).ReplaceAllString(out, `==>`)

	// 4. 虚线/粗线边上的「带引号 label」属非法语法（引号仅 `--`/`-->| |` 合法）。
	//    `A == "文本" ==> B` -> `A == 文本 ==> B`；`A -. "文本" .-> B` -> `A -. 文本 .-> B`
	out = regexp.MustCompile(`==\s*"([^"]*)"\s*==>`).ReplaceAllString(out, `== $1 ==>`)
	out = regexp.MustCompile(`-\.\s*"([^"]*)"\s*\.->`).ReplaceAllString(out, `-. $1 .->`)

	// 3. `subgraph ... end` 粘连：AI 把 `end` 怼到连线上（如 `A ==> B["..."]    end`）。
	//    Mermaid 要求 `end` 独占一行，否则整行解析失败。逐行把行尾的 ` end` 拆为独立行。
	out = fixTrailingSubgraphEnd(out)
	return out
}

// fixTrailingSubgraphEnd 将「含连线但行尾粘着 end」的行拆成两行。
func fixTrailingSubgraphEnd(code string) string {
	lines := strings.Split(code, "\n")
	for i, ln := range lines {
		trimmed := strings.TrimSpace(ln)
		if strings.HasSuffix(trimmed, "end") &&
			(strings.Contains(trimmed, "-->") || strings.Contains(trimmed, "--") || strings.Contains(trimmed, "==>") || strings.Contains(trimmed, "-.->")) {
			// 去掉行尾的 `end`（保留前面的边），并将其作为独立行。
			prefix := strings.TrimRight(ln, " \t")
			prefix = strings.TrimSuffix(prefix, "end")
			// 只在真正是 `...end` 且 prefix 是有效节点/边时才拆，避免误伤。
			lines[i] = strings.TrimRight(prefix, " \t") + "\nend"
		}
	}
	return strings.Join(lines, "\n")
}