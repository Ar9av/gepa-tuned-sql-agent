import fs from 'fs'
import path from 'path'
import crypto from 'crypto'

/**
 * Session persistence — saves chat sessions to .sessions/{db_hash}/
 *
 * Each session file contains:
 *   - messages (question, sql, feedback, rowCount, truncated preview)
 *   - prompt evolution history (generations, scores, reflections)
 *   - RL metrics snapshot
 *   - connection metadata
 *
 * Output rows are NOT saved — only rowCount, columns, and first 3 rows as preview.
 */

const SESSIONS_DIR = path.join(process.cwd(), '.sessions')

export interface SessionMessage {
  id: string
  question: string
  sql: string
  status: 'done' | 'error'
  feedback: null | 'correct' | 'wrong'
  rowCount: number
  columns: string[]
  preview: Record<string, unknown>[]  // first 3 rows only
  attempts: number
  promptGeneration: number
  timestamp: number
}

export interface SessionOptimization {
  generation: number
  score: number
  reflection: string
  diffSummary: string
  timestamp: number
}

export interface Session {
  id: string
  dbName: string
  dbType: string
  createdAt: number
  updatedAt: number
  messages: SessionMessage[]
  optimizations: SessionOptimization[]
  currentPrompt: string
  stats: {
    totalQueries: number
    correctCount: number
    wrongCount: number
    avgAttempts: number
  }
}

function hashDbName(dbName: string): string {
  return crypto.createHash('sha256').update(dbName).digest('hex').slice(0, 12)
}

function getSessionDir(dbName: string): string {
  const hash = hashDbName(dbName)
  return path.join(SESSIONS_DIR, hash)
}

function getSessionPath(dbName: string): string {
  return path.join(getSessionDir(dbName), 'session.json')
}

function getMetaPath(dbName: string): string {
  return path.join(getSessionDir(dbName), 'meta.json')
}

function ensureDir(dir: string) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
}

/**
 * Load a session for a database connection. Returns null if no session exists.
 */
export function loadSession(dbName: string): Session | null {
  try {
    const sessionPath = getSessionPath(dbName)
    if (!fs.existsSync(sessionPath)) return null
    const raw = fs.readFileSync(sessionPath, 'utf-8')
    return JSON.parse(raw) as Session
  } catch {
    return null
  }
}

/**
 * Save or update a session.
 */
export function saveSession(session: Session): void {
  try {
    const dir = getSessionDir(session.dbName)
    ensureDir(dir)

    // Save session data
    fs.writeFileSync(getSessionPath(session.dbName), JSON.stringify(session, null, 2))

    // Save lightweight meta for listing
    const meta = {
      id: session.id,
      dbName: session.dbName,
      dbType: session.dbType,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      totalQueries: session.stats.totalQueries,
      correctCount: session.stats.correctCount,
      wrongCount: session.stats.wrongCount,
    }
    fs.writeFileSync(getMetaPath(session.dbName), JSON.stringify(meta))
  } catch {
    // Non-fatal
  }
}

/**
 * Append a message to an existing session (or create one).
 */
export function appendMessage(
  dbName: string,
  dbType: string,
  message: SessionMessage,
  currentPrompt: string,
): Session {
  let session = loadSession(dbName)

  if (!session) {
    session = {
      id: `sess-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      dbName,
      dbType,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      messages: [],
      optimizations: [],
      currentPrompt,
      stats: { totalQueries: 0, correctCount: 0, wrongCount: 0, avgAttempts: 0 },
    }
  }

  // Deduplicate by message id
  if (!session.messages.some(m => m.id === message.id)) {
    session.messages.push(message)
  }

  // Recompute stats
  const completed = session.messages.filter(m => m.status === 'done' || m.status === 'error')
  session.stats.totalQueries = completed.length
  session.stats.correctCount = completed.filter(m => m.feedback === 'correct').length
  session.stats.wrongCount = completed.filter(m => m.feedback === 'wrong').length
  session.stats.avgAttempts = completed.length > 0
    ? completed.reduce((s, m) => s + m.attempts, 0) / completed.length
    : 0

  session.currentPrompt = currentPrompt
  session.updatedAt = Date.now()

  saveSession(session)
  return session
}

/**
 * Update feedback on an existing message in the session.
 */
export function updateMessageFeedback(
  dbName: string,
  messageId: string,
  feedback: 'correct' | 'wrong',
): void {
  const session = loadSession(dbName)
  if (!session) return

  const msg = session.messages.find(m => m.id === messageId)
  if (msg) {
    msg.feedback = feedback
  }

  // Recompute stats
  const completed = session.messages.filter(m => m.status === 'done' || m.status === 'error')
  session.stats.correctCount = completed.filter(m => m.feedback === 'correct').length
  session.stats.wrongCount = completed.filter(m => m.feedback === 'wrong').length
  session.updatedAt = Date.now()

  saveSession(session)
}

/**
 * Append an optimization event to the session.
 */
export function appendOptimization(
  dbName: string,
  opt: SessionOptimization,
  newPrompt: string,
): void {
  const session = loadSession(dbName)
  if (!session) return

  session.optimizations.push(opt)
  session.currentPrompt = newPrompt
  session.updatedAt = Date.now()

  saveSession(session)
}

/**
 * List all saved sessions (from meta files).
 */
export function listSessions(): { id: string; dbName: string; dbType: string; totalQueries: number; updatedAt: number }[] {
  try {
    if (!fs.existsSync(SESSIONS_DIR)) return []
    const dirs = fs.readdirSync(SESSIONS_DIR)
    const sessions: { id: string; dbName: string; dbType: string; totalQueries: number; updatedAt: number }[] = []

    for (const dir of dirs) {
      const metaPath = path.join(SESSIONS_DIR, dir, 'meta.json')
      if (fs.existsSync(metaPath)) {
        try {
          const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'))
          sessions.push({
            id: meta.id,
            dbName: meta.dbName,
            dbType: meta.dbType,
            totalQueries: meta.totalQueries,
            updatedAt: meta.updatedAt,
          })
        } catch {}
      }
    }

    return sessions.sort((a, b) => b.updatedAt - a.updatedAt)
  } catch {
    return []
  }
}
