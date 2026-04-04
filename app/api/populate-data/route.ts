import { NextRequest } from 'next/server'
import { getDb, getSchemaGraph } from '@/lib/db'
import type { SchemaGraph, ColumnMeta, FKEdge } from '@/lib/db'

// ── constraint introspection ──────────────────────────────────────────────────

// Extract CHECK IN(...) constraints from DDL: colName -> allowed values
function extractCheckEnums(db: ReturnType<typeof getDb>, tableName: string): Map<string, string[]> {
  const result = new Map<string, string[]>()
  try {
    const row = db.prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name=?`).get(tableName) as { sql: string } | undefined
    if (!row) return result
    const re = /check\s*\(\s*["'`]?(\w+)["'`]?\s+in\s*\(([^)]+)\)/gi
    let m: RegExpExecArray | null
    while ((m = re.exec(row.sql)) !== null) {
      const col = m[1].toLowerCase()
      const vals = [...m[2].matchAll(/'([^']+)'/g)].map(v => v[1])
      if (vals.length > 0) result.set(col, vals)
    }
  } catch {}
  return result
}

// Extract composite UNIQUE index column sets for a table
function extractUniqueConstraints(db: ReturnType<typeof getDb>, tableName: string): string[][] {
  const result: string[][] = []
  try {
    const indexes = db.prepare(`PRAGMA index_list("${tableName}")`).all() as { name: string; unique: number; origin: string }[]
    for (const idx of indexes) {
      if (!idx.unique) continue
      const cols = (db.prepare(`PRAGMA index_info("${idx.name}")`).all() as { name: string }[]).map(r => r.name)
      if (cols.length > 0) result.push(cols)
    }
  } catch {}
  return result
}

// ── random helpers ────────────────────────────────────────────────────────────
const FIRST_NAMES = ['Alice','Bob','Carol','David','Emma','Frank','Grace','Hank','Iris','Jack','Karen','Leo','Mia','Noah','Olivia','Pete','Quinn','Rosa','Sam','Tina','Uma','Victor','Wendy','Xander','Yara','Zoe']
const LAST_NAMES  = ['Smith','Johnson','Williams','Brown','Jones','Garcia','Miller','Davis','Wilson','Taylor','Anderson','Thomas','Moore','Martin','Lee','Clark','Lewis','Hall','Young','Allen']
const DOMAINS     = ['gmail.com','yahoo.com','outlook.com','company.com','example.org','mail.io']
const STATUSES    = ['active','inactive','pending','completed','cancelled','approved','rejected']
const CATEGORIES  = ['Electronics','Clothing','Food','Books','Sports','Home','Beauty','Toys','Tools','Auto']
const ADJECTIVES  = ['Premium','Deluxe','Basic','Pro','Ultra','Lite','Super','Smart','Classic','Advanced','Eco','Mini','Mega']
const NOUNS       = ['Widget','Gadget','Item','Product','Package','Kit','Bundle','Set','Box','Unit','Device','Module']

const rand = (n: number) => Math.floor(Math.random() * n)
const pick = <T>(arr: T[]): T => arr[rand(arr.length)]
const randFloat = (min: number, max: number) => +(min + Math.random() * (max - min)).toFixed(2)
const randDate = (daysBack = 730) => new Date(Date.now() - rand(daysBack) * 86400000).toISOString().slice(0, 10)
const randName  = () => `${pick(FIRST_NAMES)} ${pick(LAST_NAMES)}`
const randEmail = (seed: number) => `user${seed}_${rand(9999)}@${pick(DOMAINS)}`
const randPhone = () => `+1${rand(9)+1}${String(rand(1e9)).padStart(9,'0')}`

function generateValue(col: ColumnMeta, colName: string, rowIdx: number, checkEnums: Map<string, string[]>): unknown {
  const n = colName.toLowerCase()

  // CHECK constraint enum — always respected
  const enumVals = checkEnums.get(n)
  if (enumVals && enumVals.length > 0) return pick(enumVals)

  if (n.includes('email'))   return randEmail(rowIdx)
  if (n.includes('phone'))   return randPhone()
  if (n === 'name' || n.endsWith('_name') || n === 'title') {
    if (n.includes('product') || n === 'title') return `${pick(ADJECTIVES)} ${pick(NOUNS)}`
    if (n.includes('category')) return pick(CATEGORIES)
    return randName()
  }
  if (n.includes('status') || n === 'type' || n === 'state') return pick(STATUSES)
  if (n.includes('desc') || n.includes('note') || n.includes('comment') || n.includes('body') || n.includes('content') || n === 'review') {
    return `Sample ${n} #${rowIdx}`
  }
  if (n.includes('date') || n.endsWith('_at') || n.endsWith('_on') || n === 'timestamp') return randDate()
  if (n.includes('price') || n.includes('amount') || n.includes('balance') || n.includes('cost') || n.includes('total') || n.includes('salary') || n.includes('rate') || n.includes('fee')) {
    return randFloat(1, 9999)
  }
  if (n.includes('rating') || n === 'score') return rand(5) + 1
  if (n === 'age') return rand(60) + 18
  if (n.includes('count') || n.includes('quantity') || n.includes('qty') || n.includes('stock')) return rand(500) + 1

  const t = col.type.toUpperCase()
  if (t.includes('INT'))    return rowIdx + rand(1000000)
  if (t.includes('REAL') || t.includes('FLOAT') || t.includes('NUM') || t.includes('DOUBLE') || t.includes('DECIMAL')) return randFloat(1, 9999)
  if (t.includes('BOOL'))   return rand(2)
  if (t.includes('DATE') || t.includes('TIME')) return randDate()
  return `${n}_${rowIdx}_${rand(999999)}`
}

// Agentic insert loop: keep retrying until target count reached or max rounds exhausted
function populateTable(
  db: ReturnType<typeof getDb>,
  tableName: string,
  columns: ColumnMeta[],
  edges: FKEdge[],
  insertedIds: Map<string, number[]>,
  targetCount: number,
  onProgress: (inserted: number, attempt: number) => void,
): number[] {
  const fkCols = new Map<string, { toTable: string; toCol: string }>()
  for (const e of edges) {
    if (e.fromTable === tableName) fkCols.set(e.fromCol, { toTable: e.toTable, toCol: e.toCol })
  }

  const checkEnums    = extractCheckEnums(db, tableName)
  const uniqueIdxCols = extractUniqueConstraints(db, tableName)

  // Use INSERT OR IGNORE so UNIQUE violations are silently skipped instead of crashing
  const writeCols    = columns.filter(c => !(c.pk && c.type.toUpperCase().includes('INT')))
  const colNames     = writeCols.map(c => `"${c.name}"`).join(', ')
  const placeholders = writeCols.map(() => '?').join(', ')
  const stmt         = db.prepare(`INSERT OR IGNORE INTO "${tableName}" (${colNames}) VALUES (${placeholders})`)

  // Track seen combos for in-memory uniqueness checking (avoids hammering DB with guaranteed dupes)
  const seenCombos = new Set<string>()

  const insertBatch = db.transaction((rows: unknown[][]) => {
    let n = 0
    for (const row of rows) { stmt.run(row); n++ }
    return n
  })

  const idCol     = columns.find(c => c.pk)
  const MAX_ROUNDS = 20
  let inserted     = 0
  let globalIdx    = 1

  for (let round = 1; round <= MAX_ROUNDS && inserted < targetCount; round++) {
    const needed    = targetCount - inserted
    const batchSize = Math.min(500, needed * 3) // overshoot to compensate for IGNORE'd dupes
    const batch: unknown[][] = []

    for (let i = 0; i < batchSize; i++, globalIdx++) {
      const row: unknown[] = []
      let comboKey = ''

      for (const col of writeCols) {
        const fkRef = fkCols.get(col.name)
        let val: unknown
        if (fkRef) {
          const parentIds = insertedIds.get(fkRef.toTable) ?? []
          val = parentIds.length > 0 ? pick(parentIds) : globalIdx
        } else {
          val = generateValue(col, col.name, globalIdx, checkEnums)
        }
        row.push(val)

        // Build combo key for tracked unique indexes
        if (uniqueIdxCols.some(cols => cols.includes(col.name))) {
          comboKey += `${col.name}:${val}|`
        }
      }

      // Skip rows we know will be dupes (for composite unique constraints)
      if (uniqueIdxCols.length > 0 && comboKey) {
        if (seenCombos.has(comboKey)) continue
        seenCombos.add(comboKey)
      }

      batch.push(row)
    }

    insertBatch(batch)

    // Check actual count in DB
    const actual = (db.prepare(`SELECT COUNT(*) as n FROM "${tableName}"`).get() as { n: number }).n
    const delta  = actual - inserted
    inserted     = actual
    onProgress(inserted, round)

    // If we're not making progress (all rows being IGNORE'd), give up early
    if (delta === 0 && round > 3) break
    if (inserted >= targetCount) break
  }

  // Collect final IDs
  const allIds: number[] = []
  if (idCol) {
    const rows = db.prepare(`SELECT "${idCol.name}" FROM "${tableName}"`).all() as Record<string, number>[]
    for (const r of rows) allIds.push(r[idCol.name])
  }
  return allIds
}

export async function POST(req: NextRequest) {
  const { rowCount } = await req.json() as { rowCount: number }
  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: object) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))

      try {
        const graph: SchemaGraph = getSchemaGraph()
        if (graph.tables.length === 0) {
          send({ type: 'error', message: 'No schema loaded. Generate a schema first.' })
          controller.close()
          return
        }

        // Topological sort — parents before children
        const deps = new Map<string, Set<string>>()
        for (const t of graph.tables) deps.set(t.name, new Set())
        for (const e of graph.edges) {
          if (e.fromTable !== e.toTable) deps.get(e.fromTable)?.add(e.toTable)
        }
        const visited = new Set<string>()
        const insertOrder: string[] = []
        function visit(name: string) {
          if (visited.has(name)) return
          visited.add(name)
          for (const dep of (deps.get(name) ?? [])) visit(dep)
          insertOrder.push(name)
        }
        for (const t of graph.tables) visit(t.name)

        const rootTables = new Set(insertOrder.filter(t => !graph.edges.some(e => e.fromTable === t)))
        const rootCount  = Math.max(50, Math.floor(rowCount / 10))

        const db = getDb()
        db.pragma('foreign_keys = OFF')

        const insertedIds = new Map<string, number[]>()
        let totalInserted = 0

        for (const tableName of insertOrder) {
          const tableNode = graph.tables.find(t => t.name === tableName)
          if (!tableNode) continue

          const target = rootTables.has(tableName) ? rootCount : rowCount
          send({ type: 'status', message: `Populating ${tableName} (target: ${target.toLocaleString()} rows)...` })
          send({ type: 'script_chunk', chunk: `-- Populate ${tableName} (target: ${target} rows)\n` })

          const ids = populateTable(
            db, tableName, tableNode.columns, graph.edges, insertedIds, target,
            (inserted, attempt) => {
              send({ type: 'status', message: `${tableName}: ${inserted.toLocaleString()} rows inserted (attempt ${attempt})` })
            }
          )
          insertedIds.set(tableName, ids)
          totalInserted += ids.length
        }

        db.pragma('foreign_keys = ON')

        const tableStats = graph.tables.map(t => ({
          name: t.name,
          rows: (db.prepare(`SELECT COUNT(*) as n FROM "${t.name}"`).get() as { n: number }).n,
        }))
        send({ type: 'done', tableStats, totalInserted })
        controller.close()
      } catch (err: unknown) {
        send({ type: 'error', message: (err as Error).message })
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  })
}
