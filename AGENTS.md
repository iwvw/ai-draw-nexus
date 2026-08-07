# AI Draw Nexus Agent Guide

This repo is being rewritten into a Kumo-based, SQLite-backed, multi-user diagram workspace with admin management.

## Agent skills

### Issue tracker

Issues and PRDs are tracked as local Markdown under `.scratch/`. See `docs/agents/issue-tracker.md`.

### Triage labels

The default five-label vocabulary is used. See `docs/agents/triage-labels.md`.

### Domain docs

This is a single-context repo using root `CONTEXT.md` and `docs/adr/`. See `docs/agents/domain.md`.

## First files to read

1. `CONTEXT.md`
2. `docs/prd/kumo-sqlite-multiuser-admin.md`
3. `docs/process/rewrite-plan.md`
4. `docs/process/agent-handoff.md`

## Current direction

- Frontend: Kumo is the UI system. Import runtime components from `@cloudflare/kumo` and styles from `@cloudflare/kumo/styles`.
- Backend: Go is the primary runtime (`backend/`), chi router + `modernc.org/sqlite`. The Node/Hono TS backend has been removed.
- Persistence: SQLite (`data/nexus.db`) is the source of truth. Do not reintroduce JSON mock persistence for core data.
- Admin: admin access must be enforced server-side via role checks, not only by hiding routes in React.

## Local commands

- Type check and build: `node_modules/.bin/tsc -b` then `node_modules/.bin/vite build`
- Lint: `node_modules/.bin/eslint .`
- Dev: `npm run dev` (concurrently runs frontend + backend).

