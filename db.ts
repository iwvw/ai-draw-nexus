import Database from 'better-sqlite3'
import * as fs from 'fs'
import * as path from 'path'

const DB_PATH = path.join(process.cwd(), 'data.db')
const SCHEMA_PATH = path.join(process.cwd(), 'db', 'schema.sql')
const MOCK_DB_PATH = path.join(process.cwd(), '.mock-db.json')

export const db = new Database(DB_PATH)
db.pragma('journal_mode = WAL')

export function initDb() {
    const schema = fs.readFileSync(SCHEMA_PATH, 'utf-8')
    db.exec(schema)
    console.log('Database schema initialized.')

    // Check if we need to migrate from mock-db.json
    if (fs.existsSync(MOCK_DB_PATH)) {
        const rowCount = db.prepare('SELECT count(*) as count FROM users').get() as { count: number }
        if (rowCount.count === 0) {
            console.log('Migrating data from .mock-db.json to SQLite...')
            try {
                const data = JSON.parse(fs.readFileSync(MOCK_DB_PATH, 'utf-8'))
                
                const insertUser = db.prepare('INSERT INTO users (id, email, password_hash, name, created_at) VALUES (?, ?, ?, ?, ?)')
                const insertProject = db.prepare('INSERT INTO projects (id, user_id, title, engine_type, thumbnail, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
                const insertVersion = db.prepare('INSERT INTO versions (id, project_id, content, change_summary, timestamp) VALUES (?, ?, ?, ?, ?)')

                db.transaction(() => {
                    for (const user of data.users || []) {
                        // Mock DB might use 'username' instead of 'email', adjust as needed
                        insertUser.run(user.id, user.email || user.username, user.password_hash, user.name, user.created_at)
                    }
                    for (const project of data.projects || []) {
                        insertProject.run(project.id, project.user_id, project.title, project.engine_type, project.thumbnail, project.created_at, project.updated_at)
                    }
                    for (const version of data.versions || []) {
                        insertVersion.run(version.id, version.project_id, version.content, version.change_summary, version.timestamp)
                    }
                })()
                console.log('Migration completed successfully.')
            } catch (e) {
                console.error('Migration failed:', e)
            }
        }
    }
}

// Mock D1 interface for compatibility with existing PageFunctions
export const dbMock = {
    prepare: (sql: string) => {
        return {
            bind: (...args: any[]) => ({
                first: async () => {
                    return db.prepare(sql).get(...args) || null
                },
                all: async () => {
                    const results = db.prepare(sql).all(...args)
                    return { results }
                },
                run: async () => {
                    const info = db.prepare(sql).run(...args)
                    return { meta: { changes: info.changes } }
                }
            }),
            all: async () => ({ results: db.prepare(sql).all() }),
            first: async () => db.prepare(sql).get() || null,
            run: async () => {
                const info = db.prepare(sql).run()
                return { meta: { changes: info.changes } }
            }
        }
    }
}
