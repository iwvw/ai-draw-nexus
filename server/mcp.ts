import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import * as dotenv from 'dotenv'
import { db, initDb } from './db/sqlite'
import { registerMcpTools, type Actor } from './mcp/tools'

dotenv.config({ quiet: true })
dotenv.config({ path: '.dev.vars', quiet: true })
initDb()

/**
 * MCP runs on the same machine as the database, so identity is resolved
 * from MCP_USERNAME (falling back to the first registered user).
 */
function resolveActor(): Actor {
  const username = process.env.MCP_USERNAME
  const user = username
    ? (db
        .prepare('SELECT id, username, role FROM users WHERE username = ? OR email = ?')
        .get(username, username) as Actor | undefined)
    : (db.prepare('SELECT id, username, role FROM users ORDER BY created_at ASC LIMIT 1').get() as Actor | undefined)

  if (!user) {
    throw new Error('无法解析 MCP 用户：请设置 MCP_USERNAME 环境变量为已注册的用户名')
  }
  return user
}

const server = new McpServer({ name: 'ai-draw-nexus', version: '1.0.0' })
registerMcpTools(server, resolveActor)

const transport = new StdioServerTransport()
await server.connect(transport)
