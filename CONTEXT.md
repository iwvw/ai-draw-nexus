# AI Draw Nexus Context

AI Draw Nexus is a web workspace for creating, editing, and versioning diagrams with AI assistance.

## Domain Terms

### Workspace

The full application instance served by the Node/Hono runtime. A Workspace contains users, projects, versions, AI configuration, usage records, and audit records.

### User

A person who can sign in, own projects, and consume AI quota. Users have one role: `admin` or `member`.

### Admin

A User with access to admin routes and admin UI. Admins can manage users, lock accounts, inspect projects, configure AI defaults, view usage, and read audit records.

### Member

A non-admin User. Members can manage their own projects and versions.

### Project

A diagram container owned by one User. A Project has a title, engine type, thumbnail, visibility, and timestamps.

### Engine

The drawing implementation used by a Project. Current engines are `drawio`, `excalidraw`, and `mermaid`.

### Version

A saved snapshot of a Project's source content. Versions are append-friendly and preserve change summaries.

### Collaboration Room

The WebSocket room scoped to one Project. Messages must be broadcast only to clients connected to the same Project.

### Chat Message

A conversation message scoped to one Project and owned by its creator's User. Chat history is stored in SQLite (`chat_messages`) and isolated per project and per account.

### User Setting

A per-User key-value record in SQLite (`user_settings`), e.g. the user's custom LLM configuration and UI preferences. Settings follow the account across devices; the browser stores nothing.

### AI Request

A request from the Workspace to an AI provider for diagram generation or editing. It must be authorized and recorded server-side when possible.

### AI Provider Setting

Workspace-wide provider defaults, stored in SQLite. Members may still submit custom provider settings where the backend policy allows it.

### Usage Record

Server-side accounting for AI requests. It replaces client-only quota state for authenticated users.

### Audit Record

An append-only admin-visible record of security-sensitive or administrative actions.

## Architecture Direction

- Kumo is the UI system for the app shell, forms, tables, dialogs, and admin pages.
- SQLite is the persistence source of truth. Projects, versions, chat history, user settings, usage, and audit records all live in SQLite.
- Node/Hono is the primary backend runtime.
- Browser-local persistence (IndexedDB/Dexie, localStorage) is not used for core data. All application data follows the signed-in account in SQLite.
- Authentication uses an httpOnly session cookie; the JWT is never stored in browser storage.
- All runtime data lives under `data/`: `data/nexus.db` (SQLite) and `data/schema.sql` (schema definition).

## Main Modules

- `server/db/*`: SQLite connection, schema initialization, and repository functions.
- `server/ai/*`: AI provider resolution (per-user LLM config over process.env defaults), non-streaming calls, and SSE streaming for OpenAI and Anthropic.
- `server/auth-utils.ts`: password hashing, JWT creation, JWT verification, and auth payload extraction.
- `server/middleware/*`: route protection, role checks, and AI usage accounting.
- `server/routes/*`: Hono route modules (auth, projects, versions, chat history, AI chat/models, URL parsing, settings, usage, admin, health).
- `server.ts`: process entry point, Hono app mounting, and the collab WebSocket server.
- `src/components/kumo/*`: Kumo-backed frontend shell and shared UI helpers.
- `src/pages/AdminPage.tsx`: admin console.
- `src/services/*`: browser-side service adapters for backend endpoints (projectService, versionService, aiService, etc.).
- `data/`: SQLite database and schema; ignored by git, persisted as a volume in Docker.

