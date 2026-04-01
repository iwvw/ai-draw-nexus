import * as fs from 'fs'
import * as path from 'path'

const DB_PATH = path.join(process.cwd(), 'data.db')
const SCHEMA_PATH = path.join(process.cwd(), 'db', 'schema.sql')
const MOCK_DB_PATH = path.join(process.cwd(), '.mock-db.json')

let db: any = null
let isSQLite = false

try {
    const Database = (await import('better-sqlite3')).default
    db = new Database(DB_PATH)
    db.pragma('journal_mode = WAL')
    isSQLite = true
    console.log('SQLite backend initialized.')
} catch (e) {
    console.warn('Failed to load better-sqlite3, falling back to JSON mock mode.')
}

let mockData: any = { users: [], projects: [], versions: [] }
if (!isSQLite && fs.existsSync(MOCK_DB_PATH)) {
    try {
        mockData = JSON.parse(fs.readFileSync(MOCK_DB_PATH, 'utf-8'))
    } catch (e) {}
}

const saveMockData = () => {
    if (!isSQLite) {
        fs.writeFileSync(MOCK_DB_PATH, JSON.stringify(mockData, null, 2))
    }
}

export function initDb() {
    if (isSQLite) {
        const schema = fs.readFileSync(SCHEMA_PATH, 'utf-8')
        db.exec(schema)
        if (fs.existsSync(MOCK_DB_PATH)) {
            const rowCount = db.prepare('SELECT count(*) as count FROM users').get() as { count: number }
            if (rowCount.count === 0) {
                console.log('Migrating data from .mock-db.json to SQLite...')
                try {
                    const data = JSON.parse(fs.readFileSync(MOCK_DB_PATH, 'utf-8'));
                    db.transaction(() => {
                        const iu = db.prepare('INSERT INTO users (id, email, password_hash, name, created_at) VALUES (?, ?, ?, ?, ?)')
                        const ip = db.prepare('INSERT INTO projects (id, user_id, title, engine_type, thumbnail, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
                        const iv = db.prepare('INSERT INTO versions (id, project_id, content, change_summary, timestamp) VALUES (?, ?, ?, ?, ?)')
                        for (const u of data.users || []) iu.run(u.id, u.email || u.username, u.password_hash, u.name, u.created_at)
                        for (const p of data.projects || []) ip.run(p.id, p.user_id, p.title, p.engine_type, p.thumbnail, p.created_at, p.updated_at)
                        for (const v of data.versions || []) iv.run(v.id, v.project_id, v.content, v.change_summary, v.timestamp)
                    })()
                } catch (e) { console.error('Migration failed:', e) }
            }
        }
    }
}

export const dbMock = {
    prepare: (sql: string) => ({
        bind: (...args: any[]) => ({
            first: async () => {
                if (isSQLite) return db.prepare(sql).get(...args) || null
                if (sql.includes('FROM users')) return mockData.users.find((u: any) => u.username === args[0] || u.email === args[0] || u.id === args[0]) || null
                if (sql.includes('FROM projects')) return mockData.projects.find((p: any) => p.id === args[0]) || null
                if (sql.includes('FROM versions')) return mockData.versions.find((v: any) => v.id === args[0]) || null
                return null
            },
            all: async () => {
                if (isSQLite) return { results: db.prepare(sql).all(...args) }
                if (sql.includes('FROM projects')) return { results: mockData.projects.filter((p: any) => p.user_id === args[0]) }
                if (sql.includes('FROM versions')) return { results: mockData.versions.filter((v: any) => v.project_id === args[0]).sort((a: any, b: any) => (new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())) }
                return { results: [] }
            },
            run: async () => {
                if (isSQLite) return { meta: { changes: db.prepare(sql).run(...args).changes } }
                const now = new Date().toISOString()
                if (sql.includes('INSERT INTO users')) { mockData.users.push({ id: args[0], email: args[1], password_hash: args[2], name: args[3], created_at: now }); saveMockData(); }
                if (sql.includes('INSERT INTO projects')) { mockData.projects.push({ id: args[0], user_id: args[1], title: args[2], engine_type: args[3], thumbnail: args[4], created_at: now, updated_at: now }); saveMockData(); }
                if (sql.includes('INSERT INTO versions')) { mockData.versions.push({ id: args[0], project_id: args[1], content: args[2], change_summary: args[3], timestamp: now }); saveMockData(); }
                if (sql.includes('UPDATE projects')) {
                    const idIdx = sql.indexOf('WHERE id = ?') !== -1 ? sql.split('WHERE id = ?')[0].split('?').length - 1 : -1
                    const id = idIdx !== -1 ? args[idIdx] : args[args.length - 2]
                    const p = mockData.projects.find((p: any) => p.id === id)
                    if (p) {
                        if (sql.includes('title = ?')) p.title = args[sql.split('title = ?')[0].split('?').length - 1]
                        if (sql.includes('thumbnail = ?')) p.thumbnail = args[sql.split('thumbnail = ?')[0].split('?').length - 1]
                        p.updated_at = now; saveMockData();
                    }
                }
                if (sql.includes('UPDATE versions')) {
                    const v = mockData.versions.find((v: any) => v.id === args[1])
                    if (v) { v.content = args[0]; v.timestamp = now; saveMockData(); }
                }
                if (sql.includes('DELETE FROM projects')) {
                    mockData.projects = mockData.projects.filter((p: any) => p.id !== args[0]);
                    mockData.versions = mockData.versions.filter((v: any) => v.project_id !== args[0]);
                    saveMockData();
                }
                return { meta: { changes: 1 } }
            }
        }),
        all: async () => ({ results: isSQLite ? db.prepare(sql).all() : (sql.includes('FROM projects') ? mockData.projects : []) }),
        first: async () => isSQLite ? db.prepare(sql).get() || null : null,
        run: async () => {
            if (isSQLite) return { meta: { changes: db.prepare(sql).run().changes } }
            return { meta: { changes: 1 } }
        }
    })
}
export { db }
