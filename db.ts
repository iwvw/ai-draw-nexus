import * as fs from 'fs'
import * as path from 'path'

const DB_PATH = path.join(process.cwd(), 'data.db')
const SCHEMA_PATH = path.join(process.cwd(), 'db', 'schema.sql')
const MOCK_DB_PATH = path.join(process.cwd(), '.mock-db.json')

let _db: any = null
let isSQLite = false

try {
    const Database = require('better-sqlite3')
    _db = new Database(DB_PATH)
    _db.pragma('journal_mode = WAL')
    isSQLite = true
    console.log('SQLite backend initialized.')
} catch (e) {
    console.warn('better-sqlite3 not available, falling back to JSON mock mode for local dev.')
}

// JSON fallback for local development environments where native modules can't compile
let mockData: any = { users: [], projects: [], versions: [] }
if (!isSQLite) {
    if (fs.existsSync(MOCK_DB_PATH)) {
        try { mockData = JSON.parse(fs.readFileSync(MOCK_DB_PATH, 'utf-8')) } catch {}
    }
}

const saveMock = () => {
    if (!isSQLite) fs.writeFileSync(MOCK_DB_PATH, JSON.stringify(mockData, null, 2))
}

// Unified DB interface that works with both SQLite and JSON fallback
// The new Hono routes call db.prepare() directly, so this proxy must support that.
const dbProxy: any = isSQLite ? _db : {
    prepare: (sql: string) => {
        return {
            get: (...args: any[]) => {
                if (sql.includes('FROM users')) {
                    const user = mockData.users.find((u: any) =>
                        u.id === args[0] || u.email === args[0] || u.username === args[0]
                    )
                    // If login query: SELECT ... WHERE (email = ? OR id = ?) AND password_hash = ?
                    // args[0]=input, args[1]=input, args[2]=passwordHash
                    if (user && sql.includes('password_hash = ?')) {
                        const passHash = sql.includes('OR id = ?') ? args[2] : args[1];
                        if (user.password_hash !== passHash) return undefined;
                    }
                    return user || undefined
                }
                if (sql.includes('FROM projects')) {
                    const project = mockData.projects.find((p: any) => p.id === args[0])
                    // If ownership check: WHERE id = ? AND user_id = ?
                    if (project && sql.includes('user_id = ?') && args.length >= 2) {
                        if (project.user_id !== args[1]) return undefined;
                    }
                    return project || undefined
                }
                if (sql.includes('FROM versions')) {
                    if (sql.includes('JOIN projects')) {
                        return mockData.versions.find((v: any) => v.id === args[0]) || undefined
                    }
                    return mockData.versions.find((v: any) => v.id === args[0]) || undefined
                }
                return undefined
            },
            all: (...args: any[]) => {
                if (sql.includes('FROM projects')) {
                    return mockData.projects
                        .filter((p: any) => args.length === 0 || p.user_id === args[0])
                        .sort((a: any, b: any) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
                }
                if (sql.includes('FROM versions')) {
                    return mockData.versions
                        .filter((v: any) => v.project_id === args[0])
                        .sort((a: any, b: any) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
                }
                return []
            },
            run: (...args: any[]) => {
                const now = new Date().toISOString()
                if (sql.includes('INSERT INTO users')) {
                    mockData.users.push({ id: args[0], email: args[1], username: args[1], password_hash: args[2], name: args[3], created_at: now })
                    saveMock()
                    return { changes: 1 }
                }
                if (sql.includes('INSERT INTO projects')) {
                    mockData.projects.push({ id: args[0], user_id: args[1], title: args[2], engine_type: args[3], thumbnail: args[4] || '', created_at: args[5] || now, updated_at: args[6] || now })
                    saveMock()
                    return { changes: 1 }
                }
                if (sql.includes('INSERT INTO versions')) {
                    mockData.versions.push({ id: args[0], project_id: args[1], content: args[2], change_summary: args[3] || '', timestamp: args[4] || now })
                    saveMock()
                    return { changes: 1 }
                }
                if (sql.includes('UPDATE projects')) {
                    const idArgIdx = args.length - 2
                    const p = mockData.projects.find((p: any) => p.id === args[idArgIdx])
                    if (p) {
                        if (sql.includes('title = ?')) p.title = args[0]
                        if (sql.includes('thumbnail = ?')) {
                            const thumbIdx = sql.includes('title = ?') ? 1 : 0
                            p.thumbnail = args[thumbIdx]
                        }
                        p.updated_at = now
                        saveMock()
                        return { changes: 1 }
                    }
                    return { changes: 0 }
                }
                if (sql.includes('UPDATE versions')) {
                    const v = mockData.versions.find((v: any) => v.id === args[2])
                    if (v) { v.content = args[0]; v.timestamp = args[1]; saveMock(); return { changes: 1 } }
                    return { changes: 0 }
                }
                if (sql.includes('DELETE FROM versions')) {
                    const before = mockData.versions.length
                    mockData.versions = mockData.versions.filter((v: any) => v.project_id !== args[0])
                    saveMock()
                    return { changes: before - mockData.versions.length }
                }
                if (sql.includes('DELETE FROM projects')) {
                    const before = mockData.projects.length
                    mockData.projects = mockData.projects.filter((p: any) => p.id !== args[0])
                    saveMock()
                    return { changes: before - mockData.projects.length }
                }
                return { changes: 0 }
            }
        }
    },
    transaction: (fn: Function) => {
        return () => fn()
    }
}

export function initDb() {
    if (isSQLite && _db) {
        try {
            const schema = fs.readFileSync(SCHEMA_PATH, 'utf-8')
            _db.exec(schema)
            console.log('Database schema validated.')
        } catch (e) {
            console.error('Failed to initialize database schema:', e)
        }
    } else {
        console.log('Using JSON mock database at', MOCK_DB_PATH)
    }
}

// Keep dbMock export for remaining adapt() routes (chat, models, parse-url)
export const dbMock = {}

export const db = dbProxy
