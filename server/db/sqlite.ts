import Database from 'better-sqlite3'
import * as fs from 'fs'
import * as path from 'path'

const DATA_DIR = path.join(process.cwd(), 'data')
const DB_PATH = process.env.DATABASE_PATH || path.join(DATA_DIR, 'nexus.db')
const SCHEMA_PATH =
  process.env.SCHEMA_PATH ||
  (fs.existsSync(path.join(DATA_DIR, 'schema.sql'))
    ? path.join(DATA_DIR, 'schema.sql')
    : path.join(process.cwd(), 'schema.sql'))

function migrateLegacyDatabase(): void {
  const legacyPath = path.join(process.cwd(), 'data.db')
  if (process.env.DATABASE_PATH || DB_PATH === legacyPath) return
  if (fs.existsSync(DB_PATH) || !fs.existsSync(legacyPath)) return

  try {
    fs.mkdirSync(path.dirname(DB_PATH), { recursive: true })
    fs.copyFileSync(legacyPath, DB_PATH)
    console.log(`Migrated legacy database ${legacyPath} -> ${DB_PATH}`)
  } catch (err) {
    console.error('Failed to migrate legacy database:', err)
  }
}

migrateLegacyDatabase()
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true })

export const db = new Database(DB_PATH)

db.pragma('journal_mode = WAL')
db.pragma('foreign_keys = ON')
db.pragma('busy_timeout = 5000')

function tableExists(tableName: string): boolean {
  const row = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(tableName)
  return Boolean(row)
}

function columnExists(tableName: string, columnName: string): boolean {
  if (!tableExists(tableName)) return false
  const columns = db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>
  return columns.some((column) => column.name === columnName)
}

function addColumnIfMissing(tableName: string, columnName: string, ddl: string): void {
  if (!columnExists(tableName, columnName)) {
    db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${ddl}`)
  }
}

function ensureLegacyColumns(): void {
  if (tableExists('users')) {
    addColumnIfMissing('users', 'username', 'username TEXT')
    addColumnIfMissing('users', 'email', 'email TEXT')
    addColumnIfMissing('users', 'role', "role TEXT NOT NULL DEFAULT 'member'")
    addColumnIfMissing('users', 'status', "status TEXT NOT NULL DEFAULT 'active'")
    addColumnIfMissing('users', 'updated_at', 'updated_at DATETIME')
    addColumnIfMissing('users', 'last_login_at', 'last_login_at DATETIME')

    db.prepare(
      "UPDATE users SET username = COALESCE(NULLIF(username, ''), NULLIF(email, ''), id) WHERE username IS NULL OR username = ''",
    ).run()
    db.prepare("UPDATE users SET updated_at = COALESCE(updated_at, created_at, CURRENT_TIMESTAMP)").run()
  }

  if (tableExists('projects')) {
    addColumnIfMissing('projects', 'visibility', "visibility TEXT NOT NULL DEFAULT 'private'")
    addColumnIfMissing('projects', 'status', "status TEXT NOT NULL DEFAULT 'active'")
  }

  if (tableExists('versions')) {
    addColumnIfMissing('versions', 'created_by', 'created_by TEXT')
  }

  if (tableExists('ai_usage')) {
    addColumnIfMissing('ai_usage', 'status', "status TEXT NOT NULL DEFAULT 'success'")
  }
}

function seedSettings(): void {
  const stmt = db.prepare(
    `INSERT OR IGNORE INTO settings (key, value, updated_by, updated_at)
     VALUES (?, ?, NULL, CURRENT_TIMESTAMP)`,
  )

  stmt.run(
    'ai.provider_defaults',
    JSON.stringify({
      provider: process.env.AI_PROVIDER || 'openai',
      baseUrl: process.env.AI_BASE_URL || 'https://api.openai.com/v1',
      modelId: process.env.AI_MODEL_ID || '',
    }),
  )
  stmt.run('ai.daily_quota', process.env.DAILY_QUOTA || '10')
  stmt.run('security.allow_registration', process.env.ALLOW_REGISTRATION || 'true')
  stmt.run('security.allow_public_access', process.env.ALLOW_PUBLIC_ACCESS || 'true')
}

function promoteFirstUserIfNeeded(): void {
  const admin = db.prepare("SELECT id FROM users WHERE role = 'admin' LIMIT 1").get()
  if (admin) return

  const firstUser = db.prepare('SELECT id FROM users ORDER BY created_at ASC LIMIT 1').get() as
    | { id: string }
    | undefined
  if (firstUser) {
    db.prepare("UPDATE users SET role = 'admin', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(firstUser.id)
  }
}

export function initDb(): void {
  if (!fs.existsSync(SCHEMA_PATH)) {
    const hasTables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' LIMIT 1")
      .get()
    if (hasTables) {
      ensureLegacyColumns()
      seedSettings()
      promoteFirstUserIfNeeded()
      console.log(`SQLite database ready at ${DB_PATH} (schema file unavailable, existing tables kept)`)
      return
    }
    throw new Error(`Database schema not found at ${SCHEMA_PATH}`)
  }

  const schema = fs.readFileSync(SCHEMA_PATH, 'utf-8')
  ensureLegacyColumns()
  db.exec(schema)
  ensureLegacyColumns()
  seedSettings()
  promoteFirstUserIfNeeded()

  console.log(`SQLite database ready at ${DB_PATH}`)
}
