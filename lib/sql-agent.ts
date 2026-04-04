import { llm, MODEL } from './llm'
import { executeSQL, getSchemaInfo } from './db'
import { getCurrentPrompt, recordResult } from './gepa'

export type AgentEvent =
  | { type: 'attempt_start'; attempt: number; maxAttempts: number }
  | { type: 'sql_chunk'; chunk: string; attempt: number }
  | { type: 'sql_complete'; sql: string; attempt: number }
  | { type: 'executing'; attempt: number }
  | { type: 'error'; attempt: number; error: string }
  | { type: 'diagnosis_start'; attempt: number }
  | { type: 'diagnosis_chunk'; chunk: string; attempt: number }
  | { type: 'diagnosis_complete'; diagnosis: string; attempt: number }
  | { type: 'success'; attempt: number; rows: Record<string, unknown>[]; rowCount: number; sql: string }
  | { type: 'failed'; attempts: number }
  | { type: 'optimization_start' }
  | { type: 'optimization_done'; reflection: string; newPrompt: string }

function extractSQL(raw: string): string {
  // Strip markdown code fences if model adds them despite instructions
  return raw
    .replace(/```sql\s*/gi, '')
    .replace(/```\s*/g, '')
    .trim()
}

export async function* runSQLAgent(question: string): AsyncGenerator<AgentEvent> {
  const schema = getSchemaInfo()
  const systemPrompt = getCurrentPrompt()
  const MAX_ATTEMPTS = 5

  let lastError = ''
  let lastSQL = ''
  const errors: string[] = []

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    yield { type: 'attempt_start', attempt, maxAttempts: MAX_ATTEMPTS }

    // Build user message — on retries, include error context
    const userMessage =
      attempt === 1
        ? `Schema:\n${schema}\n\nQuestion: ${question}`
        : `Schema:\n${schema}\n\nQuestion: ${question}\n\nPrevious SQL that failed:\n${lastSQL}\n\nError: ${lastError}\n\nFix the SQL.`

    // Stream SQL generation
    let sql = ''
    const sqlStream = await llm.chat.completions.create({
      model: MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
      temperature: attempt === 1 ? 0.1 : 0.3, // more creative on retries
      stream: true,
    })

    for await (const chunk of sqlStream) {
      const delta = chunk.choices[0]?.delta?.content
      if (delta) {
        sql += delta
        yield { type: 'sql_chunk', chunk: delta, attempt }
      }
    }

    sql = extractSQL(sql)
    lastSQL = sql
    yield { type: 'sql_complete', sql, attempt }
    yield { type: 'executing', attempt }

    // Execute
    const result = executeSQL(sql)

    if (result.success) {
      // Record success for GEPA
      recordResult({
        question,
        finalSQL: sql,
        attempts: attempt,
        success: true,
        errors,
        timestamp: Date.now(),
      })

      yield {
        type: 'success',
        attempt,
        rows: result.rows,
        rowCount: result.rowCount,
        sql,
      }
      return
    }

    // Execution failed — diagnose
    lastError = result.error
    errors.push(result.error)
    yield { type: 'error', attempt, error: result.error }

    if (attempt < MAX_ATTEMPTS) {
      yield { type: 'diagnosis_start', attempt }

      let diagnosis = ''
      const diagStream = await llm.chat.completions.create({
        model: MODEL,
        messages: [
          {
            role: 'system',
            content:
              'You are a SQLite debugging expert. Given a failing SQL query and its error, explain in ONE sentence what is wrong and what specific fix is needed. Be precise — name the exact column, function, or syntax issue.',
          },
          {
            role: 'user',
            content: `Schema:\n${schema}\n\nFailing SQL:\n${sql}\n\nError: ${result.error}`,
          },
        ],
        temperature: 0.1,
        stream: true,
      })

      for await (const chunk of diagStream) {
        const delta = chunk.choices[0]?.delta?.content
        if (delta) {
          diagnosis += delta
          yield { type: 'diagnosis_chunk', chunk: delta, attempt }
        }
      }

      yield { type: 'diagnosis_complete', diagnosis, attempt }
    }
  }

  // All attempts exhausted
  recordResult({
    question,
    finalSQL: lastSQL,
    attempts: MAX_ATTEMPTS,
    success: false,
    errors,
    timestamp: Date.now(),
  })

  yield { type: 'failed', attempts: MAX_ATTEMPTS }
}
