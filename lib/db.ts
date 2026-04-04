import Database from 'better-sqlite3'
import path from 'path'
import os from 'os'

const DB_PATH = path.join(os.tmpdir(), 'sql-agent-demo.db')

let _db: Database.Database | null = null

export function getDb(): Database.Database {
  if (!_db) {
    _db = new Database(DB_PATH)
    _db.pragma('journal_mode = WAL')
    _db.pragma('foreign_keys = ON')
  }
  return _db
}

export function resetDb() {
  if (_db) { _db.close(); _db = null }
  try {
    const fs = require('fs')
    if (fs.existsSync(DB_PATH)) fs.unlinkSync(DB_PATH)
  } catch {}
}

export function executeSQL(sql: string): { success: true; rows: Record<string, unknown>[]; rowCount: number } | { success: false; error: string } {
  try {
    const db = getDb()
    const trimmed = sql.trim()
    if (/^select/i.test(trimmed)) {
      const rows = db.prepare(trimmed).all() as Record<string, unknown>[]
      return { success: true, rows, rowCount: rows.length }
    }
    db.exec(trimmed)
    return { success: true, rows: [], rowCount: 0 }
  } catch (err: unknown) {
    return { success: false, error: (err as Error).message }
  }
}

export function getSchemaInfo(): string {
  try {
    const db = getDb()
    const tables = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`).all() as { name: string }[]
    const parts: string[] = []
    for (const { name } of tables) {
      const cols = db.prepare(`PRAGMA table_info("${name}")`).all() as { name: string; type: string; notnull: number; pk: number }[]
      const colDefs = cols.map(c => `  ${c.name} ${c.type}${c.pk ? ' PRIMARY KEY' : ''}${c.notnull ? ' NOT NULL' : ''}`).join(',\n')
      const count = (db.prepare(`SELECT COUNT(*) as n FROM "${name}"`).get() as { n: number }).n
      parts.push(`TABLE ${name} (${count} rows):\n${colDefs}`)
    }
    return parts.join('\n\n')
  } catch { return 'No schema loaded yet.' }
}

export interface ColumnMeta { name: string; type: string; pk: boolean; notnull: boolean }
export interface FKEdge { fromTable: string; fromCol: string; toTable: string; toCol: string }
export interface TableNode { name: string; columns: ColumnMeta[]; rowCount: number }
export interface SchemaGraph { tables: TableNode[]; edges: FKEdge[] }

export function getSchemaGraph(): SchemaGraph {
  try {
    const db = getDb()
    const tableNames = (db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`).all() as { name: string }[]).map(r => r.name)
    const tables: TableNode[] = []
    const edges: FKEdge[] = []
    for (const name of tableNames) {
      const cols = (db.prepare(`PRAGMA table_info("${name}")`).all() as { name: string; type: string; notnull: number; pk: number }[])
        .map(c => ({ name: c.name, type: c.type, pk: c.pk > 0, notnull: c.notnull > 0 }))
      const rowCount = (db.prepare(`SELECT COUNT(*) as n FROM "${name}"`).get() as { n: number }).n
      tables.push({ name, columns: cols, rowCount })
      const fks = db.prepare(`PRAGMA foreign_key_list("${name}")`).all() as { table: string; from: string; to: string }[]
      for (const fk of fks) {
        edges.push({ fromTable: name, fromCol: fk.from, toTable: fk.table, toCol: fk.to })
      }
    }
    return { tables, edges }
  } catch { return { tables: [], edges: [] } }
}

export function getTablePage(table: string, page: number, pageSize: number): { rows: Record<string, unknown>[]; totalCount: number; columns: string[] } {
  try {
    const db = getDb()
    const safeTable = table.replace(/[^a-zA-Z0-9_]/g, '')
    const totalCount = (db.prepare(`SELECT COUNT(*) as n FROM "${safeTable}"`).get() as { n: number }).n
    const rows = db.prepare(`SELECT * FROM "${safeTable}" LIMIT ? OFFSET ?`).all(pageSize, page * pageSize) as Record<string, unknown>[]
    const columns = rows.length > 0 ? Object.keys(rows[0]) : (db.prepare(`PRAGMA table_info("${safeTable}")`).all() as { name: string }[]).map(c => c.name)
    return { rows, totalCount, columns }
  } catch { return { rows: [], totalCount: 0, columns: [] } }
}

// Topological sort for INSERT order (parents before children)
export function getInsertOrder(): string[] {
  try {
    const graph = getSchemaGraph()
    const deps = new Map<string, Set<string>>()
    for (const t of graph.tables) deps.set(t.name, new Set())
    for (const e of graph.edges) {
      if (e.fromTable !== e.toTable) deps.get(e.fromTable)?.add(e.toTable)
    }
    const visited = new Set<string>()
    const result: string[] = []
    function visit(name: string) {
      if (visited.has(name)) return
      visited.add(name)
      for (const dep of (deps.get(name) ?? [])) visit(dep)
      result.push(name)
    }
    for (const t of graph.tables) visit(t.name)
    return result
  } catch { return [] }
}
