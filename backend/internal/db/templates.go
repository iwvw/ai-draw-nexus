// Package db 的数据访问。本文件保存模板（templates）相关查询与内置模板 seed。
package db

import (
	"database/sql"
)

// Template 对应 templates 表一条记录。
type Template struct {
	ID          string     `json:"id"`
	Code        string     `json:"code"` // 稳定编号，供 LLM/用户引用，如 T01
	Name        string     `json:"name"`
	Description string     `json:"description"`
	Type        string     `json:"type"`         // prompt | skeleton
	EngineType  string     `json:"engine_type"`  // drawio | excalidraw | mermaid
	Scope       string     `json:"scope"`        // system | workspace | private
	Content     string     `json:"content"`
	OwnerID     NullString `json:"owner_id"`
	CreatedAt   string     `json:"created_at"`
	UpdatedAt   string     `json:"updated_at"`
}

// ListVisibleTemplates 返回某用户可见的模板（system 全局 + 自己的 private + workspace）。
func (s *Store) ListVisibleTemplates(userID string) ([]Template, error) {
	rows, err := s.db.Query(
		`SELECT id, code, name, description, type, engine_type, scope, content, owner_id, created_at, updated_at
		 FROM templates
		 WHERE scope='system' OR (scope='workspace') OR (scope='private' AND owner_id=?)
		 ORDER BY scope ASC, updated_at DESC`,
		userID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Template{}
	for rows.Next() {
		var t Template
		if err := rows.Scan(&t.ID, &t.Code, &t.Name, &t.Description, &t.Type, &t.EngineType,
			&t.Scope, &t.Content, &t.OwnerID, &t.CreatedAt, &t.UpdatedAt); err != nil {
			return nil, err
		}
		out = append(out, t)
	}
	return out, rows.Err()
}

// GetTemplateByID 返回指定模板（仅当用户可见）。
func (s *Store) GetTemplateByID(userID, id string) (*Template, error) {
	var t Template
	err := s.db.QueryRow(
		`SELECT id, code, name, description, type, engine_type, scope, content, owner_id, created_at, updated_at
		 FROM templates WHERE id = ?
		 AND (scope='system' OR scope='workspace' OR (scope='private' AND owner_id=?))`,
		id, userID,
	).Scan(&t.ID, &t.Code, &t.Name, &t.Description, &t.Type, &t.EngineType,
		&t.Scope, &t.Content, &t.OwnerID, &t.CreatedAt, &t.UpdatedAt)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &t, nil
}

// GetTemplateByCodeVisible 按编号取可见模板。
func (s *Store) GetTemplateByCodeVisible(userID, code string) (*Template, error) {
	var t Template
	err := s.db.QueryRow(
		`SELECT id, code, name, description, type, engine_type, scope, content, owner_id, created_at, updated_at
		 FROM templates WHERE code = ?
		 AND (scope='system' OR scope='workspace' OR (scope='private' AND owner_id=?))`,
		code, userID,
	).Scan(&t.ID, &t.Code, &t.Name, &t.Description, &t.Type, &t.EngineType,
		&t.Scope, &t.Content, &t.OwnerID, &t.CreatedAt, &t.UpdatedAt)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &t, nil
}

// CreateTemplate 插入模板。scope 由调用方决定（system/workspace 需权限）。
func (s *Store) CreateTemplate(t *Template) error {
	_, err := s.db.Exec(
		`INSERT INTO templates (id, code, name, description, type, engine_type, scope, content, owner_id, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
		t.ID, t.Code, t.Name, t.Description, t.Type, t.EngineType, t.Scope, t.Content, t.OwnerID,
	)
	return err
}

// UpdateTemplate 更新模板名称/描述/类型/内容（仅本人拥有或管理员）。
func (s *Store) UpdateTemplate(id, ownerID string, name, description, typ, content *string) (bool, error) {
	res, err := s.db.Exec(
		`UPDATE templates SET name=COALESCE(?,name), description=COALESCE(?,description),
		 type=COALESCE(?,type), content=COALESCE(?,content), updated_at=CURRENT_TIMESTAMP
		 WHERE id=? AND owner_id IS NOT NULL AND owner_id=?`,
		name, description, typ, content, id, ownerID,
	)
	if err != nil {
		return false, err
	}
	n, _ := res.RowsAffected()
	return n > 0, nil
}

// DeleteTemplate 删除私有模板（仅 owner）。
func (s *Store) DeleteTemplate(ownerID, id string) (bool, error) {
	res, err := s.db.Exec(
		"DELETE FROM templates WHERE id=? AND owner_id=? AND scope='private'", id, ownerID,
	)
	if err != nil {
		return false, err
	}
	n, _ := res.RowsAffected()
	return n > 0, nil
}

// CodeExists 检查模板编号是否已被占用（任意 scope）。
func (s *Store) CodeExists(code string) (bool, error) {
	var n int
	err := s.db.QueryRow("SELECT COUNT(*) FROM templates WHERE code=?", code).Scan(&n)
	return n > 0, err
}

// SeedSystemTemplates 幂等同步内置系统模板。
// 每次启动重写 system 模板（内置模板可安全覆盖，含修复历史损坏内容）。
func (s *Store) SeedSystemTemplates() error {
	defs := []Template{
		{
			ID: "tpl-flow-drawio", Code: "T01", Name: "流程 / 架构图骨架",
			Description: "通用分层流程图骨架（Draw.io）：自上而下分层，代码整洁可编辑",
			Type:        "skeleton", EngineType: "drawio", Scope: "system", OwnerID: NewNullString(""),
			Content: `<mxGraphModel dx="1000" dy="800" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="827" pageHeight="1169" math="0" shadow="0">
  <root>
    <mxCell id="0" />
    <mxCell id="1" parent="0" />
    <mxCell id="2" value="节点A" style="rounded=1;whiteSpace=wrap;html=1;fillColor=#dae8fc;strokeColor=#6c8ebf;" vertex="1" parent="1">
      <mxGeometry x="300" y="80" width="140" height="60" as="geometry" />
    </mxCell>
    <mxCell id="3" value="节点B" style="rounded=1;whiteSpace=wrap;html=1;fillColor=#dae8fc;strokeColor=#6c8ebf;" vertex="1" parent="1">
      <mxGeometry x="300" y="200" width="140" height="60" as="geometry" />
    </mxCell>
    <mxCell id="4" value="" style="edgeStyle=orthogonalEdgeStyle;rounded=0;html=1;" edge="1" parent="1" source="2" target="3">
      <mxGeometry relative="1" as="geometry" />
    </mxCell>
  </root>
</mxGraphModel>`,
		},
		{
			ID: "tpl-roadmap-drawio", Code: "T02", Name: "研究技术路线图骨架",
			Description: "学术论文技术路线图骨架（Draw.io）：阶段+内容+方法三列，纵向流程。",
			Type:        "skeleton", EngineType: "drawio", Scope: "system", OwnerID: NewNullString(""),
			Content: `<mxfile host="ai-draw-nexus">
  <diagram id="roadmap" name="技术路线图">
    <mxGraphModel dx="1000" dy="800" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="1100" pageHeight="1500" math="0" shadow="0">
      <root>
        <mxCell id="0" />
        <mxCell id="1" parent="0" />
        <mxCell id="h1" value="研究阶段" style="rounded=0;whiteSpace=wrap;html=1;fontStyle=1;fillColor=none;" vertex="1" parent="1"><mxGeometry x="60" y="40" width="120" height="35" as="geometry" /></mxCell>
        <mxCell id="h2" value="研究内容" style="rounded=0;whiteSpace=wrap;html=1;fontStyle=1;fillColor=none;" vertex="1" parent="1"><mxGeometry x="320" y="40" width="260" height="35" as="geometry" /></mxCell>
        <mxCell id="h3" value="研究方法" style="rounded=0;whiteSpace=wrap;html=1;fontStyle=1;fillColor=none;" vertex="1" parent="1"><mxGeometry x="640" y="40" width="140" height="35" as="geometry" /></mxCell>
        <mxCell id="p1" value="阶段一" style="rounded=1;whiteSpace=wrap;html=1;" vertex="1" parent="1"><mxGeometry x="60" y="120" width="200" height="70" as="geometry" /></mxCell>
        <mxCell id="p2" value="阶段二" style="rounded=1;whiteSpace=wrap;html=1;" vertex="1" parent="1"><mxGeometry x="60" y="280" width="200" height="70" as="geometry" /></mxCell>
        <mxCell id="p3" value="阶段三" style="rounded=1;whiteSpace=wrap;html=1;" vertex="1" parent="1"><mxGeometry x="60" y="440" width="200" height="70" as="geometry" /></mxCell>
        <mxCell id="e1" style="endArrow=classic;html=1;" edge="1" parent="1" source="p1" target="p2"><mxGeometry relative="1" as="geometry" /></mxCell>
        <mxCell id="e2" style="endArrow=classic;html=1;" edge="1" parent="1" source="p2" target="p3"><mxGeometry relative="1" as="geometry" /></mxCell>
      </root>
    </mxGraphModel>
  </diagram>
</mxfile>`,
		},
	}

	if _, err := s.db.Exec("DELETE FROM templates WHERE scope='system'"); err != nil {
		return err
	}
	for _, d := range defs {
		if err := s.CreateTemplate(&d); err != nil {
			return err
		}
	}
	_, _ = s.db.Exec("DELETE FROM settings WHERE key='templates.seeded'")
	return s.UpsertSetting("templates.seeded", "1")
}