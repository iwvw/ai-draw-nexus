import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { Hono } from 'hono'
import { logger } from 'hono/logger'
import { cors } from 'hono/cors'
import { bodyLimit } from 'hono/body-limit'
import { WebSocketServer, WebSocket } from 'ws'
import * as dotenv from 'dotenv'
import * as fs from 'fs'
import * as path from 'path'
import { db, initDb, dbMock } from './db'
import authRouter from './server/routes/auth'
import projectsRouter from './server/routes/projects'
import versionsRouter from './server/routes/versions'
import { onRequest as chatHandler } from './functions/api/chat'
import { onRequest as modelsHandler } from './functions/api/models'
import { onRequest as parseUrlHandler } from './functions/api/parse-url'
import { onRequest as collabHandler } from './functions/api/collab'

// Load environment variables
dotenv.config()
// Also load from .dev.vars if exists (for local dev compatibility)
dotenv.config({ path: '.dev.vars' })

// Initialize database
initDb()

const app = new Hono()

app.use('*', logger())
app.use('/api/*', cors())
app.use('/api/*', bodyLimit({
    maxSize: 10 * 1024 * 1024, // 10MB
    onError: (c) => c.text('Body too large', 413),
}))

// Adapter to convert Hono context to Cloudflare Pages Functions context
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const adapt = (handler: any) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return async (c: any) => {
        const req = c.req.raw
        const env = { ...process.env } as any

        // Use our new SQLite-backed D1 mock
        if (!env.DB) {
            env.DB = dbMock
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

// Native Hono Routes (Zod validated)
app.route('/api/auth', authRouter)
app.route('/api/projects', projectsRouter)
app.route('/api/versions', versionsRouter)

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
