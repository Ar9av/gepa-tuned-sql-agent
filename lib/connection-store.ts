import fs from 'fs'
import path from 'path'
import type { DBType } from './connector'

export interface StoredConnection {
  id: string
  name: string
  type: DBType
  connectionString?: string  // for pg/mysql
  filename?: string          // for sqlite
  savedPrompt?: string       // GEPA-evolved prompt
  lastConnected?: number
}

const DATA_DIR = path.join(process.cwd(), 'data')
const CONNECTIONS_FILE = path.join(DATA_DIR, 'connections.json')

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true })
}

export function loadConnections(): StoredConnection[] {
  try {
    ensureDir()
    if (!fs.existsSync(CONNECTIONS_FILE)) return []
    return JSON.parse(fs.readFileSync(CONNECTIONS_FILE, 'utf-8'))
  } catch {
    return []
  }
}

export function saveConnections(connections: StoredConnection[]) {
  ensureDir()
  fs.writeFileSync(CONNECTIONS_FILE, JSON.stringify(connections, null, 2))
}

export function upsertConnection(conn: StoredConnection) {
  const all = loadConnections()
  const idx = all.findIndex(c => c.id === conn.id)
  if (idx >= 0) {
    all[idx] = { ...all[idx], ...conn }
  } else {
    all.push(conn)
  }
  saveConnections(all)
}

export function deleteConnection(id: string) {
  const all = loadConnections().filter(c => c.id !== id)
  saveConnections(all)
}

export function getConnection(id: string): StoredConnection | undefined {
  return loadConnections().find(c => c.id === id)
}

export function updatePrompt(connectionName: string, prompt: string) {
  const all = loadConnections()
  const conn = all.find(c => c.name === connectionName)
  if (conn) {
    conn.savedPrompt = prompt
    saveConnections(all)
  }
}

// Return connections with credentials masked for the browser
export function listConnectionsSafe(): Omit<StoredConnection, 'connectionString'>[] {
  return loadConnections().map(({ connectionString, ...rest }) => {
    void connectionString
    return rest
  })
}
