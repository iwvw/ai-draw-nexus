import * as fs from 'fs'
import * as path from 'path'

const DB_PATH = path.join(process.cwd(), 'data.db')
const SCHEMA_PATH = path.join(process.cwd(), 'db', 'schema.sql')

let db: any = null

try {
    const Database = require('better-sqlite3')
    db = new Database(DB_PATH)
    db.pragma('journal_mode = WAL')
    console.log('SQLite backend initialized.')
} catch (e) {
    console.error('Failed to load better-sqlite3. The backend requires SQLite to run. Please install it.')
    process.exit(1)
}

export function initDb() {
    if (db) {
        try {
            const schema = fs.readFileSync(SCHEMA_PATH, 'utf-8')
            db.exec(schema)
            console.log('Database schema validated.')
        } catch (e) {
            console.error('Failed to initialize database schema:', e)
        }
    }
}

// Keep a dummy dbMock to prevent server.ts adapt() from crashing for remaining functions
// Since the remaining functions (chat, models, parse-url) don't actually use env.DB, this is safe.
export const dbMock = {}

export { db }
