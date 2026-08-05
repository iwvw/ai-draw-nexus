# ADR 0001: Node/Hono + SQLite Is the Primary Runtime

Status: accepted

## Context

The repo previously mixed three persistence/runtime paths:

- React + Dexie for local projects
- Node/Hono routes using a root `db.ts`
- Cloudflare Pages Functions adapted into the Node server

The SQLite path was not reliable because `db.ts` used CommonJS `require` inside an ESM project and fell back to a JSON mock. The schema also drifted from route assumptions.

## Decision

The primary runtime is Node/Hono with SQLite via `better-sqlite3`.

Core auth, project, version, admin, usage, and audit behavior must live behind server modules that run in Node. Cloudflare Pages Functions can remain as compatibility code, but they are not the source of truth for multi-user persistence or admin behavior.

## Consequences

- SQLite schema initialization happens at Node startup.
- Admin and member authorization is enforced in Hono middleware.
- New backend work should target Node/Hono first.
- Cloudflare deployment requires a deliberate follow-up rewrite or adapter strategy rather than silent drift.

