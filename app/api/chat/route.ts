import { NextRequest } from 'next/server'
import { llm, MODEL } from '@/lib/llm'
import { getCurrentPrompt } from '@/lib/gepa'
import { getActiveConfig, executeQueryAsync } from '@/lib/connector'
import { extractSchemaGraph, formatSchemaAsText } from '@/lib/schema-extractor'

const MAX_ATTEMPTS = 3

function extractSQL(raw: string): string {
  return raw
    .replace(/```sql\s*/gi, '')
    .replace(/```\s*/g, '')
    .trim()
}

export async function POST(req: NextRequest) {
  const { question, businessContext } = (await req.json()) as { question: string; businessContext?: string }

  if (!question?.trim()) {
    return new Response('Question required', { status: 400 })
  }

  const activeConfig = getActiveConfig()
  if (!activeConfig) {
    return new Response(
      `data: ${JSON.stringify({ type: 'error', error: 'No database connected', attempt: 0 })}\n\n`,
      {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
        },
      }
    )
  }

  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: object) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))
      }

      try {
        // Get schema
        const schemaGraph = await extractSchemaGraph()
        const schemaText = formatSchemaAsText(schemaGraph)
        const systemPrompt = getCurrentPrompt()

        let lastError = ''
        let lastSQL = ''

        for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
          send({ type: 'attempt_start', attempt })

          const contextBlock = businessContext ? `\n\nBusiness Context:\n${businessContext}` : ''
          const userMessage =
            attempt === 1
              ? `Schema:\n${schemaText}${contextBlock}\n\nQuestion: ${question}`
              : `Schema:\n${schemaText}${contextBlock}\n\nQuestion: ${question}\n\nPrevious SQL that failed:\n${lastSQL}\n\nError: ${lastError}\n\nFix the SQL.`

          // Step 1: Generate reasoning
          let reasoning = ''
          const reasoningStream = await llm.chat.completions.create({
            model: MODEL,
            messages: [
              { role: 'system', content: `You are a SQL expert. Given a schema and a natural language question, explain your reasoning for how to write the SQL query. Be concise (3-5 bullet points). Focus on: which tables to join, what aggregations are needed, any tricky parts (date functions, window functions, subqueries). Do NOT output SQL — only the reasoning.` },
              { role: 'user', content: userMessage },
            ],
            temperature: 0.1,
            stream: true,
          })

          for await (const chunk of reasoningStream) {
            const delta = chunk.choices[0]?.delta?.content
            if (delta) {
              reasoning += delta
              send({ type: 'reasoning_chunk', chunk: delta, attempt })
            }
          }
          send({ type: 'reasoning_complete', reasoning, attempt })

          // Step 2: Generate SQL (with reasoning as context)
          let sql = ''
          const sqlStream = await llm.chat.completions.create({
            model: MODEL,
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: userMessage + `\n\nReasoning:\n${reasoning}` },
            ],
            temperature: attempt === 1 ? 0.1 : 0.3,
            stream: true,
          })

          for await (const chunk of sqlStream) {
            const delta = chunk.choices[0]?.delta?.content
            if (delta) {
              sql += delta
              send({ type: 'sql_chunk', chunk: delta, attempt })
            }
          }

          sql = extractSQL(sql)
          lastSQL = sql
          send({ type: 'sql_complete', sql, attempt })
          send({ type: 'executing', attempt })

          const result = await executeQueryAsync(sql)

          if (!result.error) {
            send({
              type: 'success',
              sql,
              rows: result.rows,
              rowCount: result.rowCount,
              attempt,
            })
            controller.close()
            return
          }

          lastError = result.error
          send({ type: 'error', error: result.error, attempt })

          if (attempt < MAX_ATTEMPTS) {
            // Stream diagnosis
            let diagnosis = ''
            const diagStream = await llm.chat.completions.create({
              model: MODEL,
              messages: [
                {
                  role: 'system',
                  content:
                    'You are a SQL debugging expert. Given a failing SQL query and its error, explain in ONE sentence what is wrong and what specific fix is needed.',
                },
                {
                  role: 'user',
                  content: `Schema:\n${schemaText}\n\nFailing SQL:\n${sql}\n\nError: ${result.error}`,
                },
              ],
              temperature: 0.1,
              stream: true,
            })

            for await (const chunk of diagStream) {
              const delta = chunk.choices[0]?.delta?.content
              if (delta) {
                diagnosis += delta
                send({ type: 'diagnosis_chunk', chunk: delta, attempt })
              }
            }

            void diagnosis // used for streaming only
          }
        }

        send({ type: 'failed', attempts: MAX_ATTEMPTS, lastError, lastSQL })
      } catch (err: unknown) {
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({ type: 'error', error: (err as Error).message, attempt: 0 })}\n\n`
          )
        )
      } finally {
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
