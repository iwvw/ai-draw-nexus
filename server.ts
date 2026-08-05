import { serve } from '@hono/node-server'
import * as dotenv from 'dotenv'
import type { Server as HttpServer } from 'http'
import { WebSocket, WebSocketServer } from 'ws'
import { initDb } from './server/db/sqlite'
import { createApp } from './server/app'

dotenv.config()
dotenv.config({ path: '.dev.vars' })

initDb()

const app = createApp()
const port = parseInt(process.env.PORT || '8787', 10)

console.log(`Server is starting on port ${port}...`)

const server = serve({
  fetch: app.fetch,
  port,
})

const wss = new WebSocketServer({ server: server as HttpServer, path: '/api/collab' })
const rooms = new Map<string, Set<WebSocket>>()

wss.on('connection', (ws, request) => {
  const url = new URL(request.url || '/api/collab', `http://${request.headers.host || 'localhost'}`)
  const projectId = url.searchParams.get('projectId') || 'global'
  const room = rooms.get(projectId) || new Set<WebSocket>()
  room.add(ws)
  rooms.set(projectId, room)

  console.log(`WS: Client connected to project ${projectId}`)

  ws.on('message', (message) => {
    for (const client of room) {
      if (client !== ws && client.readyState === WebSocket.OPEN) {
        client.send(message)
      }
    }
  })

  ws.on('close', () => {
    console.log(`WS: Client disconnected from project ${projectId}`)
    room.delete(ws)
    if (room.size === 0) {
      rooms.delete(projectId)
    }
  })
})

console.log(`Server running at http://localhost:${port}`)
