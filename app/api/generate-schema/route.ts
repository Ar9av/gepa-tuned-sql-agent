import { NextRequest } from 'next/server'
import { llm, MODEL } from '@/lib/llm'
import { resetDb, getDb, getSchemaGraph } from '@/lib/db'
import { resetOptimizer } from '@/lib/gepa'
import { ECOMMERCE_DDL_PROMPT } from '@/lib/schemas/ecommerce'
import { HOSPITAL_DDL_PROMPT } from '@/lib/schemas/hospital'
import { BANKING_DDL_PROMPT } from '@/lib/schemas/banking'
import { BENCHMARK_DDL_PROMPT } from '@/lib/schemas/benchmark'

const DDL_PROMPTS: Record<string, string> = {
  ecommerce: ECOMMERCE_DDL_PROMPT,
  hospital: HOSPITAL_DDL_PROMPT,
  banking: BANKING_DDL_PROMPT,
}

// Sort CREATE TABLE statements so parents come before children
function topoSortDDL(statements: string[]): string[] {
  const creates = statements.filter(s => /^create\s+table/i.test(s))
  const others = statements.filter(s => !/^create\s+table/i.test(s))

  // Extract table name from CREATE TABLE statement
  const getName = (s: string) => s.match(/create\s+table\s+(?:if\s+not\s+exists\s+)?["']?(\w+)["']?/i)?.[1]?.toLowerCase() ?? ''
  // Extract referenced tables from REFERENCES clauses
  const getRefs = (s: string) => [...s.matchAll(/references\s+["']?(\w+)["']?/gi)].map(m => m[1].toLowerCase())

  const deps = new Map<string, Set<string>>()
  for (const s of creates) deps.set(getName(s), new Set(getRefs(s).filter(r => r !== getName(s))))

  const visited = new Set<string>()
  const result: string[] = []
  function visit(name: string) {
    if (visited.has(name)) return
    visited.add(name)
    for (const dep of (deps.get(name) ?? [])) {
      const stmt = creates.find(s => getName(s) === dep)
      if (stmt) visit(dep)
    }
    const stmt = creates.find(s => getName(s) === name)
    if (stmt) result.push(stmt)
  }
  for (const s of creates) visit(getName(s))
  return [...others, ...result]
}

export async function POST(req: NextRequest) {
  const { schemaType } = await req.json()

  if (schemaType !== 'benchmark' && !DDL_PROMPTS[schemaType]) {
    return new Response('Unknown schema type', { status: 400 })
  }

  resetDb()
  resetOptimizer()

  const encoder = new TextEncoder()

  // Benchmark schema: execute DDL directly — no LLM needed, schema is exact
  if (schemaType === 'benchmark') {
    const stream = new ReadableStream({
      async start(controller) {
        const send = (data: object) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))
        try {
          send({ type: 'status', message: 'Creating benchmark schema...' })

          const statements = BENCHMARK_DDL_PROMPT
            .split(/;\s*\n/)
            .map(s => s.trim())
            .filter(s => s.length > 3)

          const db = getDb()
          db.pragma('foreign_keys = OFF')

          let executed = 0
          for (const stmt of statements) {
            try {
              db.exec(stmt + (stmt.endsWith(';') ? '' : ';'))
              executed++
            } catch (e: unknown) {
              send({ type: 'warning', message: `Skipped: ${(e as Error).message.slice(0, 80)}` })
            }
          }

          db.pragma('foreign_keys = ON')

          const tables = (db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`).all() as { name: string }[])
          const tableStats = tables.map(({ name }) => ({
            name,
            rows: (db.prepare(`SELECT COUNT(*) as n FROM "${name}"`).get() as { n: number }).n,
          }))

          const schemaGraph = getSchemaGraph()
          send({ type: 'done', tableStats, statements: executed, schemaGraph })
        } catch (err: unknown) {
          send({ type: 'error', message: (err as Error).message })
        } finally {
          controller.close()
        }
      },
    })

    return new Response(stream, {
      headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' },
    })
  }

  const prompt = DDL_PROMPTS[schemaType]

  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: object) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))

      try {
        send({ type: 'status', message: 'LLM is writing the schema...' })

        let fullSQL = ''
        const sqlStream = await llm.chat.completions.create({
          model: MODEL,
          messages: [
            { role: 'system', content: 'You are a database architect. Output ONLY valid SQLite DDL — no markdown, no code fences, no explanations, no INSERT statements.' },
            { role: 'user', content: prompt },
          ],
          temperature: 0.3,
          stream: true,
        })

        for await (const chunk of sqlStream) {
          const delta = chunk.choices[0]?.delta?.content
          if (delta) {
            fullSQL += delta
            send({ type: 'script_chunk', chunk: delta })
          }
        }

        send({ type: 'status', message: 'Creating tables...' })

        // Parse and sort statements
        const rawStatements = fullSQL
          .replace(/```sql\s*/gi, '').replace(/```\s*/g, '')
          .split(/;\s*\n/)
          .map(s => s.trim())
          .filter(s => s.length > 3)

        const sorted = topoSortDDL(rawStatements)
        const db = getDb()
        db.pragma('foreign_keys = OFF')

        let executed = 0
        for (const stmt of sorted) {
          try {
            db.exec(stmt + (stmt.endsWith(';') ? '' : ';'))
            executed++
          } catch (e: unknown) {
            send({ type: 'warning', message: `Skipped: ${(e as Error).message.slice(0, 80)}` })
          }
        }

        db.pragma('foreign_keys = ON')

        const tables = (db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`).all() as { name: string }[])
        const tableStats = tables.map(({ name }) => ({
          name,
          rows: (db.prepare(`SELECT COUNT(*) as n FROM "${name}"`).get() as { n: number }).n,
        }))

        const schemaGraph = getSchemaGraph()
        send({ type: 'done', tableStats, statements: executed, schemaGraph })
      } catch (err: unknown) {
        send({ type: 'error', message: (err as Error).message })
      } finally {
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' },
  })
}
