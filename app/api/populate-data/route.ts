import { NextRequest } from 'next/server'
import { llm, MODEL } from '@/lib/llm'
import { getDb, getSchemaGraph } from '@/lib/db'
import { buildPopulatePrompt } from '@/lib/schemas/populate-prompts'

export async function POST(req: NextRequest) {
  const { rowCount } = await req.json() as { rowCount: number }
  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: object) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))

      try {
        const graph = getSchemaGraph()
        if (graph.tables.length === 0) {
          send({ type: 'error', message: 'No schema loaded. Generate a schema first.' })
          return
        }

        send({ type: 'status', message: `LLM is writing population script for ~${rowCount.toLocaleString()} rows...` })

        const populatePrompt = buildPopulatePrompt(graph, rowCount)

        let fullSQL = ''
        const sqlStream = await llm.chat.completions.create({
          model: MODEL,
          messages: [
            { role: 'system', content: 'You are a SQLite data generation expert. Output ONLY valid SQL statements. No markdown, no explanations.' },
            { role: 'user', content: populatePrompt },
          ],
          temperature: 0.7,
          stream: true,
        })

        for await (const chunk of sqlStream) {
          const delta = chunk.choices[0]?.delta?.content
          if (delta) {
            fullSQL += delta
            send({ type: 'script_chunk', chunk: delta })
          }
        }

        send({ type: 'status', message: 'Executing population script...' })

        const db = getDb()
        db.pragma('foreign_keys = OFF')

        // Split on semicolons but preserve CTEs (WITH ... AS (...) INSERT ...)
        const statements = fullSQL
          .replace(/```sql\s*/gi, '').replace(/```\s*/g, '')
          .replace(/--[^\n]*/g, '') // strip comments before splitting
          .split(/;\s*\n/)
          .map(s => s.trim())
          .filter(s => s.length > 5 && !/^--/.test(s))

        let executed = 0
        let skipped = 0
        for (const stmt of statements) {
          try {
            db.exec(stmt + (stmt.endsWith(';') ? '' : ';'))
            executed++
          } catch (e: unknown) {
            skipped++
            if (skipped <= 3) send({ type: 'warning', message: `Skipped: ${(e as Error).message.slice(0, 100)}` })
          }
        }

        db.pragma('foreign_keys = ON')

        const tables = (db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`).all() as { name: string }[])
        const tableStats = tables.map(({ name }) => ({
          name,
          rows: (db.prepare(`SELECT COUNT(*) as n FROM "${name}"`).get() as { n: number }).n,
        }))

        send({ type: 'done', tableStats, executed, skipped })
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
