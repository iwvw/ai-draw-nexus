# Kumo Shell 与后台 UI

Status: ready-for-agent

Implementation state: current worktree contains the first implementation; rerun verification and browser smoke before closing.

## Goal

在保留现有绘图引擎的前提下，将主应用外壳和后台管理迁移到 Kumo。

## Acceptance Criteria

- Kumo 依赖和样式已配置。
- 应用导航使用 Kumo-backed shell。
- 后台路由为 `/admin`。
- 后台页面展示统计、用户、项目、设置、用量和审计。
- 非管理员不能访问后台 UI。
- 类型检查和生产构建通过。
