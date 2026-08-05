import assert from 'node:assert/strict'
import { existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, describe, it } from 'node:test'

const dbPath = join(tmpdir(), `ai-draw-nexus-${Date.now()}-${Math.random().toString(16).slice(2)}.db`)

process.env.DATABASE_PATH = dbPath
process.env.JWT_SECRET = 'test-secret'
process.env.ALLOW_REGISTRATION = 'true'
process.env.DISABLE_REGISTRATION = 'false'
process.env.NODE_ENV = 'test'

const { db, initDb } = await import('../server/db/sqlite')
const { createApp } = await import('../server/app')

initDb()
const app = createApp()

after(() => {
  db.close()
  for (const path of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) {
    if (existsSync(path)) rmSync(path, { force: true })
  }
})

async function requestJson<T>(
  path: string,
  options: {
    method?: string
    token?: string
    body?: unknown
  } = {},
): Promise<{ status: number; data: T }> {
  const response = await app.request(path, {
    method: options.method || 'GET',
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  })

  const text = await response.text()
  const data = text ? (JSON.parse(text) as T) : (null as T)
  return { status: response.status, data }
}

type AuthResponse = {
  user: {
    id: string
    username: string
    role: 'admin' | 'member'
  }
  token: string
}

type ErrorResponse = {
  error: string
}

describe('SQLite auth and admin routes', () => {
  it('bootstraps the first user as admin and protects admin routes', async () => {
    const admin = await requestJson<AuthResponse>('/api/auth/register', {
      method: 'POST',
      body: {
        username: 'admin',
        password: 'secret123',
      },
    })

    assert.equal(admin.status, 201)
    assert.equal(admin.data.user.role, 'admin')

    const member = await requestJson<AuthResponse>('/api/auth/register', {
      method: 'POST',
      body: {
        username: 'member',
        password: 'secret123',
      },
    })

    assert.equal(member.status, 201)
    assert.equal(member.data.user.role, 'member')

    const denied = await requestJson<ErrorResponse>('/api/admin/stats', {
      token: member.data.token,
    })
    assert.equal(denied.status, 403)

    const stats = await requestJson<{ users: number; admins: number }>('/api/admin/stats', {
      token: admin.data.token,
    })
    assert.equal(stats.status, 200)
    assert.equal(stats.data.users, 2)
    assert.equal(stats.data.admins, 1)
  })

  it('keeps project access owner-scoped', async () => {
    const owner = await requestJson<AuthResponse>('/api/auth/login', {
      method: 'POST',
      body: { username: 'member', password: 'secret123' },
    })

    const outsider = await requestJson<AuthResponse>('/api/auth/register', {
      method: 'POST',
      body: {
        username: 'outsider',
        password: 'secret123',
      },
    })

    const created = await requestJson<{ id: string }>('/api/projects', {
      method: 'POST',
      token: owner.data.token,
      body: {
        title: 'Owner project',
        engine_type: 'mermaid',
      },
    })

    assert.equal(created.status, 201)
    assert.ok(created.data.id)

    const ownerDetail = await requestJson<{ id: string }>(`/api/projects/detail?id=${created.data.id}`, {
      token: owner.data.token,
    })
    assert.equal(ownerDetail.status, 200)
    assert.equal(ownerDetail.data.id, created.data.id)

    const outsiderDetail = await requestJson<ErrorResponse>(`/api/projects/detail?id=${created.data.id}`, {
      token: outsider.data.token,
    })
    assert.equal(outsiderDetail.status, 404)
  })

  it('blocks suspended users from logging in', async () => {
    const admin = await requestJson<AuthResponse>('/api/auth/login', {
      method: 'POST',
      body: { username: 'admin', password: 'secret123' },
    })
    const users = await requestJson<Array<{ id: string; username: string }>>('/api/admin/users', {
      token: admin.data.token,
    })
    const member = users.data.find((user) => user.username === 'member')
    assert.ok(member)

    const suspended = await requestJson<{ success: true }>(`/api/admin/users/${member.id}`, {
      method: 'PATCH',
      token: admin.data.token,
      body: { status: 'suspended' },
    })
    assert.equal(suspended.status, 200)

    const login = await requestJson<ErrorResponse>('/api/auth/login', {
      method: 'POST',
      body: { username: 'member', password: 'secret123' },
    })
    assert.equal(login.status, 403)
  })

  it('keeps chat history project-scoped and user-isolated', async () => {
    const owner = await requestJson<AuthResponse>('/api/auth/register', {
      method: 'POST',
      body: { username: 'alice', password: 'secret123' },
    })
    const outsider = await requestJson<AuthResponse>('/api/auth/register', {
      method: 'POST',
      body: { username: 'bob', password: 'secret123' },
    })

    const created = await requestJson<{ id: string }>('/api/projects', {
      method: 'POST',
      token: owner.data.token,
      body: { title: 'Chat project', engine_type: 'mermaid' },
    })
    assert.equal(created.status, 201)

    const saved = await requestJson<{ id: string }>('/api/chat/history', {
      method: 'POST',
      token: owner.data.token,
      body: {
        project_id: created.data.id,
        role: 'user',
        content: '画一个流程图',
        status: 'complete',
      },
    })
    assert.equal(saved.status, 201)

    const ownerHistory = await requestJson<Array<{ role: string; content: string }>>(
      `/api/chat/history?project_id=${created.data.id}`,
      { token: owner.data.token },
    )
    assert.equal(ownerHistory.status, 200)
    assert.equal(ownerHistory.data.length, 1)
    assert.equal(ownerHistory.data[0].content, '画一个流程图')

    const outsiderHistory = await requestJson<ErrorResponse>(
      `/api/chat/history?project_id=${created.data.id}`,
      { token: outsider.data.token },
    )
    assert.equal(outsiderHistory.status, 404)

    const outsiderSave = await requestJson<ErrorResponse>('/api/chat/history', {
      method: 'POST',
      token: outsider.data.token,
      body: { project_id: created.data.id, role: 'user', content: '越权写入' },
    })
    assert.equal(outsiderSave.status, 404)

    const cleared = await requestJson<{ success: boolean }>(
      `/api/chat/history?project_id=${created.data.id}`,
      { method: 'DELETE', token: owner.data.token },
    )
    assert.equal(cleared.status, 200)

    const afterClear = await requestJson<Array<{ role: string }>>(
      `/api/chat/history?project_id=${created.data.id}`,
      { token: owner.data.token },
    )
    assert.equal(afterClear.data.length, 0)
  })

  it('stores per-user LLM settings in SQLite', async () => {
    const member = await requestJson<AuthResponse>('/api/auth/login', {
      method: 'POST',
      body: { username: 'alice', password: 'secret123' },
    })

    const saved = await requestJson<{ key: string }>('/api/settings', {
      method: 'PUT',
      token: member.data.token,
      body: {
        key: 'llm.config',
        value: {
          provider: 'openai',
          baseUrl: 'https://api.example.com/v1',
          apiKey: 'sk-test-123',
          modelId: 'gpt-4o-mini',
        },
      },
    })
    assert.equal(saved.status, 200)

    const loaded = await requestJson<{ 'llm.config'?: { apiKey: string } }>('/api/settings', {
      token: member.data.token,
    })
    assert.equal(loaded.status, 200)
    assert.equal(loaded.data['llm.config']?.apiKey, 'sk-test-123')

    const usage = await requestJson<{ used: number; quota: number }>('/api/usage/today', {
      token: member.data.token,
    })
    assert.equal(usage.status, 200)
    assert.ok(usage.data.quota >= 0)
  })
})
