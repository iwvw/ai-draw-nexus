import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import type { IncomingMessage, ServerResponse } from 'http'
import { AsyncLocalStorage } from 'node:async_hooks'
import { randomUUID } from 'node:crypto'
import { verifyToken } from './auth-utils'
import { isApiTokenValid } from './db/api-tokens'
import { db } from './db/sqlite'
import { registerMcpTools, type Actor } from './mcp/tools'

const actorStorage = new AsyncLocalStorage<Actor>()

function resolveActor(): Actor {
  const actor = actorStorage.getStore()
  if (actor) return actor
  throw new Error('MCP HTTP 请求缺少用户上下文')
}

interface McpSession {
  server: McpServer
  transport: StreamableHTTPServerTransport
}

const sessions = new Map<string, McpSession>()

function createSession(): McpSession {
  const server = new McpServer({ name: 'ai-draw-nexus', version: '1.0.0' })
  registerMcpTools(server, resolveActor)

  const session: McpSession = { server, transport: undefined as unknown as StreamableHTTPServerTransport }

  session.transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
    onsessioninitialized: (id) => {
      sessions.set(id, session)
    },
    onsessionclosed: (id) => {
      sessions.delete(id)
    },
  })

  void server.connect(session.transport)
  return session
}

async function requestBaseUrl(req: IncomingMessage): Promise<string> {
  const proto = req.headers['x-forwarded-proto'] || 'http'
  const host = req.headers.host
  if (host) return `${proto}://${host}`
  return ''
}

async function authenticate(req: IncomingMessage): Promise<Actor | null> {
  const authHeader = req.headers.authorization
  if (!authHeader?.startsWith('Bearer ')) return null
  const payload = await verifyToken(authHeader.slice('Bearer '.length))
  if (!payload) return null
  if (payload.jti && !isApiTokenValid(payload.jti)) return null
  const user = (db
    .prepare('SELECT id, username, role, status FROM users WHERE id = ?')
    .get(payload.userId) as (Actor & { status: string }) | undefined)
  if (!user || user.status !== 'active') return null
  const baseUrl = (await requestBaseUrl(req)) || process.env.PUBLIC_BASE_URL || ''
  return { id: user.id, username: user.username, role: user.role, baseUrl }
}

function writeJson(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(body))
}

export async function handleMcpHttpRequest(req: IncomingMessage, res: ServerResponse) {
  const actor = await authenticate(req)
  if (!actor) {
    writeJson(res, 401, {
      jsonrpc: '2.0',
      error: { code: -32001, message: '未授权：请携带有效的 Bearer Token' },
      id: null,
    })
    return
  }

  res.setHeader('access-control-allow-origin', '*')
  res.setHeader('access-control-allow-methods', 'GET, POST, OPTIONS')
  res.setHeader('access-control-allow-headers', 'authorization, content-type, mcp-session-id')
  if (req.method === 'OPTIONS') {
    res.writeHead(204)
    res.end()
    return
  }

  if (req.method === 'GET') {
    const sessionId = req.headers['mcp-session-id']
    if (sessionId && !sessions.has(String(sessionId))) {
      writeJson(res, 404, { jsonrpc: '2.0', error: { code: -32000, message: '会话不存在或已过期' }, id: null })
      return
    }
  }

  let session = sessions.get(String(req.headers['mcp-session-id'] || ''))
  if (!session) {
    session = createSession()
  }

  await actorStorage.run(actor, () => session!.transport.handleRequest(req, res, undefined))
}
