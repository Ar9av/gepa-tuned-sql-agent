import knex, { Knex } from 'knex'
import path from 'path'
import os from 'os'

export type DBType = 'sqlite' | 'postgresql' | 'mysql'

const BENCHMARK_DB_PATH = path.join(os.tmpdir(), 'sql-agent-demo.db')

export interface DBConfig {
  type: DBType
  connectionString?: string  // for pg/mysql: full URI
  filename?: string          // for sqlite: file path
  name: string               // display name
}

// Module-level singleton
let _knex: Knex | null = null
let _config: DBConfig | null = null

export function getKnex(): Knex | null {
  return _knex
}

export function getActiveConfig(): DBConfig | null {
  return _config
}

export async function connectDB(config: DBConfig): Promise<{ ok: boolean; error?: string }> {
  // Disconnect existing
  if (_knex) {
    try { await _knex.destroy() } catch {}
  }

  try {
    let knexConfig: Knex.Config

    if (config.type === 'sqlite') {
      knexConfig = {
        client: 'better-sqlite3',
        connection: { filename: config.filename || BENCHMARK_DB_PATH },
        useNullAsDefault: true,
      }
    } else if (config.type === 'postgresql') {
      knexConfig = {
        client: 'pg',
        connection: {
          connectionString: config.connectionString,
          ssl: { rejectUnauthorized: false },
        },
        pool: { min: 0, max: 3 },
      }
    } else {
      knexConfig = {
        client: 'mysql2',
        connection: config.connectionString,
        pool: { min: 0, max: 3 },
      }
    }

    _knex = knex(knexConfig)

    // Catch pool errors so they don't crash the process
    _knex.client.pool?.on?.('error', (err: Error) => {
      console.error('[knex pool error]', err.message)
    })

    // Test connection
    await _knex.raw('SELECT 1')
    _config = config
    return { ok: true }
  } catch (err) {
    _knex = null
    _config = null
    return { ok: false, error: (err as Error).message }
  }
}

export function disconnectDB() {
  if (_knex) { _knex.destroy().catch(() => {}) }
  _knex = null
  _config = null
}

export async function executeQueryAsync(sql: string): Promise<{ rows: Record<string, unknown>[]; rowCount: number; error?: string }> {
  if (!_knex) return { rows: [], rowCount: 0, error: 'No database connected' }

  try {
    const result = await _knex.raw(sql)
    let rows: Record<string, unknown>[] = []

    if (_config?.type === 'postgresql') {
      rows = result.rows ?? []
    } else if (_config?.type === 'mysql') {
      rows = Array.isArray(result[0]) ? result[0] : []
    } else {
      // SQLite with better-sqlite3 via knex returns array directly
      rows = Array.isArray(result) ? result : (result?.rows ?? [])
    }

    return { rows, rowCount: rows.length }
  } catch (err) {
    return { rows: [], rowCount: 0, error: (err as Error).message }
  }
}
