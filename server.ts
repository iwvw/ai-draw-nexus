import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { Hono } from 'hono'
import { logger } from 'hono/logger'
import { cors } from 'hono/cors'
import { WebSocketServer, WebSocket } from 'ws'
import * as dotenv from 'dotenv'
import * as fs from 'fs'
import * as path from 'path'
import { onRequest as chatHandler } from './functions/api/chat'
import { onRequest as modelsHandler } from './functions/api/models'
import { onRequest as parseUrlHandler } from './functions/api/parse-url'
import { onRequest as registerHandler } from './functions/api/auth/register'
import { onRequest as loginHandler } from './functions/api/auth/login'
import { onRequest as meHandler } from './functions/api/auth/me'
import { onRequest as projectsHandler } from './functions/api/projects/index'
import { onRequest as projectDetailHandler } from './functions/api/projects/detail'
import { onRequest as versionsHandler } from './functions/api/versions/index'
import { onRequest as versionDetailHandler } from './functions/api/versions/detail'
import { onRequest as collabHandler } from './functions/api/collab'

// Load environment variables
dotenv.config()
// Also load from .dev.vars if exists (for local dev compatibility)
dotenv.config({ path: '.dev.vars' })

// FILE-BASED MOCK DB for local dev persistence
const MOCK_DB_PATH = path.join(process.cwd(), '.mock-db.json')

const loadMockDb = () => {
    if (fs.existsSync(MOCK_DB_PATH)) {
        try {
            return JSON.parse(fs.readFileSync(MOCK_DB_PATH, 'utf-8'))
        } catch (e) {
            console.error('Failed to load mock DB, starting fresh', e)
        }
    }
    return { users: [], projects: [], versions: [] }
}

const saveMockDb = (data: any) => {
    try {
        fs.writeFileSync(MOCK_DB_PATH, JSON.stringify(data, null, 2))
    } catch (e) {
        console.error('Failed to save mock DB', e)
    }
}

const mockDb = loadMockDb()

const app = new Hono()

app.use('*', logger())
app.use('/api/*', cors())

// Adapter to convert Hono context to Cloudflare Pages Functions context
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const adapt = (handler: any) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return async (c: any) => {
        const req = c.req.raw
        const env = { ...process.env } as any

        // MOCK D1 for local dev
        if (!env.DB) {
            env.DB = {
                prepare: (sql: string) => ({
                    bind: (...args: any[]) => ({
                        first: async () => {
                            console.log(`[D1 Mock] First: ${sql} with [${args}]`)
                            // Handle JOIN query for versions/detail
                            if (sql.includes('FROM versions v JOIN projects p')) {
                                return mockDb.versions.find(v => v.id === args[0]) || null
                            }
                            if (sql.includes('FROM users')) {
                                if (sql.includes('username = ? AND password_hash = ?')) {
                                    return mockDb.users.find(u => u.username === args[0] && u.password_hash === args[1]) || null
                                }
                                if (sql.includes('username = ?')) {
                                    return mockDb.users.find(u => u.username === args[0]) || null
                                }
                            }
                            if (sql.includes('FROM projects') && sql.includes('id = ?')) {
                                return mockDb.projects.find(p => p.id === args[0]) || null
                            }
                            if (sql.includes('FROM versions') && sql.includes('id = ?')) {
                                return mockDb.versions.find(v => v.id === args[0]) || null
                            }
                            return null
                        },
                        all: async () => {
                            console.log(`[D1 Mock] All: ${sql} with [${args}]`)
                            if (sql.includes('FROM projects')) {
                                const results = mockDb.projects.filter(p => p.user_id === args[0])
                                return { results }
                            }
                            if (sql.includes('FROM versions')) {
                                const results = mockDb.versions
                                    .filter(v => v.project_id === args[0])
                                    .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))
                                return { results }
                            }
                            return { results: [] }
                        },
                        run: async () => {
                            console.log(`[D1 Mock] Run: ${sql} with [${args}]`)
                            const now = new Date().toISOString()
                            if (sql.includes('INSERT INTO users')) {
                                mockDb.users.push({ id: args[0], username: args[1], password_hash: args[2], name: args[3], created_at: now })
                                saveMockDb(mockDb)
                            }
                            if (sql.includes('INSERT INTO projects')) {
                                mockDb.projects.push({ id: args[0], user_id: args[1], title: args[2], engine_type: args[3], thumbnail: args[4], created_at: now, updated_at: now })
                                saveMockDb(mockDb)
                            }
                            if (sql.includes('INSERT INTO versions')) {
                                mockDb.versions.push({ id: args[0], project_id: args[1], content: args[2], change_summary: args[3], timestamp: now })
                                saveMockDb(mockDb)
                            }
                            if (sql.includes('UPDATE projects')) {
                                const p = mockDb.projects.find(p => p.id === args[1] || (sql.includes('WHERE id = ?') && args[0] === p?.id))
                                if (p) {
                                    if (sql.includes('SET title = ?')) p.title = args[0]
                                    if (sql.includes('SET updated_at')) p.updated_at = now
                                    saveMockDb(mockDb)
                                }
                            }
                            if (sql.includes('UPDATE versions')) {
                                const v = mockDb.versions.find(v => v.id === args[1])
                                if (v) {
                                  v.content = args[0]
                                  v.timestamp = now
                                  saveMockDb(mockDb)
                                }
                            }
                            if (sql.includes('DELETE FROM projects')) {
                                mockDb.projects = mockDb.projects.filter(p => p.id !== args[0])
                                mockDb.versions = mockDb.versions.filter(v => v.project_id !== args[0])
                                saveMockDb(mockDb)
                            }
                            return { meta: { changes: 1 } }
                        }
                    }),
                    all: async () => ({ results: [] }),
                    first: async () => null,
                    run: async () => ({ meta: { changes: 1 } })
                })
            }
        }

        // Construct a mock context
        const context = {
            request: req,
            env: env,
            params: c.req.param(),
            waitUntil: (promise: Promise<unknown>) => {
                // In Node, we just let it float or await it if critical?
                // Usually waitUntil is for background tasks.
                // We can just execute it.
                promise.catch(err => console.error('waitUntil error:', err))
            },
            next: () => Promise.resolve(),
            data: {}
        }

        try {
            const res = await handler(context)
            return res
        } catch (error) {
            console.error('API Error:', error)
            return c.json({ error: error instanceof Error ? error.message : 'Internal Server Error' }, 500)
        }
    }
}

// API Routes
app.all('/api/chat', adapt(chatHandler))
app.all('/api/models', adapt(modelsHandler))
app.all('/api/parse-url', adapt(parseUrlHandler))
app.all('/api/collab', adapt(collabHandler))

// Auth
app.all('/api/auth/register', adapt(registerHandler))
app.all('/api/auth/login', adapt(loginHandler))
app.all('/api/auth/me', adapt(meHandler))

// Projects & Versions
app.all('/api/projects', adapt(projectsHandler))
app.all('/api/projects/detail', adapt(projectDetailHandler))
app.all('/api/versions', adapt(versionsHandler))
app.all('/api/versions/detail', adapt(versionDetailHandler))

// Serve static files from 'dist' (Vite build output)
app.use('/*', serveStatic({ root: './dist' }))

// Fallback for SPA routing (if file not found, serve index.html)
// serveStatic in Hono usually handles files. If not found, we explicitly serve index.html
app.get('*', serveStatic({ root: './dist', path: 'index.html' }))


const port = parseInt(process.env.PORT || '8787')
console.log(`Server is starting on port ${port}...`)

const server = serve({
    fetch: app.fetch,
    port
})

// Setup WebSocket for Collab
const wss = new WebSocketServer({ server: server as any, path: '/api/collab' })

const clients = new Set<WebSocket>()

wss.on('connection', (ws) => {
    console.log('WS: Client connected')
    clients.add(ws)

    ws.on('message', (message) => {
        // Broadcast to all other clients
        for (const client of clients) {
            if (client !== ws && client.readyState === WebSocket.OPEN) {
                client.send(message)
            }
        }
    })

    ws.on('close', () => {
        console.log('WS: Client disconnected')
        clients.delete(ws)
    })
})

console.log(`Server running at http://localhost:${port}`)
