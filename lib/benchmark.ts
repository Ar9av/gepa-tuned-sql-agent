import { llm, MODEL } from './llm'
import { executeSQL, getSchemaInfo } from './db'
import { GOLDEN_QUERIES } from './golden-dataset'

export type BenchmarkEvent =
  | { type: 'query_start'; id: string; question: string; index: number; total: number }
  | { type: 'sql_generated'; id: string; sql: string }
  | { type: 'query_result'; id: string; pass: boolean; score: number; reason: string; sql: string; refRowCount: number; agentRowCount: number }
  | { type: 'done'; overallScore: number; passed: number; total: number; results: BenchmarkResult[] }

export interface BenchmarkResult {
  id: string
  question: string
  difficulty: string
  pass: boolean
  score: number
  reason: string
  sql: string
  refRowCount: number
  agentRowCount: number
}

// ---------------------------------------------------------------------------
// Reference comparison — the core scoring signal
// ---------------------------------------------------------------------------

function fuzzyColumnMatch(agentCols: string[], refCols: string[]): number {
  if (refCols.length === 0) return 1
  let matched = 0
  for (const rc of refCols) {
    const rLower = rc.toLowerCase()
    if (agentCols.some(ac => {
      const aLower = ac.toLowerCase()
      return aLower === rLower || aLower.includes(rLower) || rLower.includes(aLower)
    })) matched++
  }
  return matched / refCols.length
}

function valueOverlapScore(
  agentRows: Record<string, unknown>[],
  refRows: Record<string, unknown>[],
): number {
  if (agentRows.length === 0 || refRows.length === 0) return 0

  // Use first column of reference as the key column
  const refFirstCol = Object.keys(refRows[0])[0]
  const agentFirstCol = Object.keys(agentRows[0])[0]

  const refVals = new Set(refRows.map(r => String(r[refFirstCol])))
  const agentVals = agentRows.map(r => String(r[agentFirstCol]))

  if (refVals.size === 0) return 1

  // What fraction of agent values appear in the reference?
  const overlap = agentVals.filter(v => refVals.has(v)).length
  const agentPrecision = overlap / agentVals.length
  // What fraction of reference values appear in agent?
  const agentValSet = new Set(agentVals)
  const refRecall = [...refVals].filter(v => agentValSet.has(v)).length / refVals.size

  return (agentPrecision + refRecall) / 2
}

function compareToReference(
  agentRows: Record<string, unknown>[],
  refRows: Record<string, unknown>[],
): { score: number; reason: string } {
  // Both empty — ambiguous (data might not satisfy the query)
  if (refRows.length === 0 && agentRows.length === 0) {
    return { score: 0.5, reason: 'Both reference and agent returned 0 rows — may be valid for this dataset' }
  }

  // Reference has rows but agent got nothing — clear fail
  if (refRows.length > 0 && agentRows.length === 0) {
    return { score: 0.0, reason: `Reference returns ${refRows.length} rows; agent returned 0` }
  }

  // Agent returned rows but reference got nothing — suspicious
  if (refRows.length === 0 && agentRows.length > 0) {
    return { score: 0.3, reason: `Reference returned 0 rows but agent returned ${agentRows.length} — agent may be querying wrong data` }
  }

  // Both have rows — compare
  const agentCols = Object.keys(agentRows[0])
  const refCols = Object.keys(refRows[0])

  const colScore = fuzzyColumnMatch(agentCols, refCols)

  // Row count closeness (within 20% = full score, within 50% = partial)
  const ratio = Math.min(agentRows.length, refRows.length) / Math.max(agentRows.length, refRows.length)
  const countScore = ratio >= 0.8 ? 1.0 : ratio >= 0.5 ? 0.7 : 0.4

  const valScore = valueOverlapScore(agentRows, refRows)

  const combined = colScore * 0.3 + countScore * 0.4 + valScore * 0.3

  const reason = combined >= 0.8
    ? `Correct: agent=${agentRows.length} rows, ref=${refRows.length} rows, col match=${(colScore * 100).toFixed(0)}%`
    : `Partial: agent=${agentRows.length} rows vs ref=${refRows.length}; col match=${(colScore * 100).toFixed(0)}%, value overlap=${(valScore * 100).toFixed(0)}%`

  return { score: combined, reason }
}

// ---------------------------------------------------------------------------
// Main benchmark runner
// ---------------------------------------------------------------------------

export async function* runBenchmark(systemPrompt: string, queryIds?: string[]): AsyncGenerator<BenchmarkEvent> {
  const queries = queryIds
    ? GOLDEN_QUERIES.filter(q => queryIds.includes(q.id))
    : GOLDEN_QUERIES

  const schema = getSchemaInfo()
  const results: BenchmarkResult[] = []

  for (let i = 0; i < queries.length; i++) {
    const q = queries[i]
    yield { type: 'query_start', id: q.id, question: q.question, index: i + 1, total: queries.length }

    // Step 1: Run reference SQL to get ground truth
    const refResult = executeSQL(q.referenceSQL.trim())
    const refRows = refResult.success ? refResult.rows : []

    let agentSQL = ''
    let finalScore = 0
    let finalReason = 'Not executed'
    let agentRowCount = 0

    try {
      // Step 2: Generate SQL from agent
      const completion = await llm.chat.completions.create({
        model: MODEL,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: `Schema:\n${schema}\n\nQuestion: ${q.question}` },
        ],
        temperature: 0.1,
      })

      agentSQL = (completion.choices[0].message.content ?? '').replace(/```sql\s*/gi, '').replace(/```\s*/g, '').trim()
      yield { type: 'sql_generated', id: q.id, sql: agentSQL }

      // Step 3: Execute agent SQL
      const agentResult = executeSQL(agentSQL)

      if (!agentResult.success) {
        finalScore = 0
        finalReason = `SQL error: ${agentResult.error}`
        agentRowCount = 0
      } else {
        agentRowCount = agentResult.rows.length

        // Step 4: Compare against reference (primary signal, 70%)
        const refComparison = compareToReference(agentResult.rows, refRows)

        // Step 5: Structural validation (secondary signal, 30%)
        const structural = q.validate(agentResult.rows)

        // If reference comparison is decisive (clearly right or wrong), weight it heavily
        if (refRows.length > 0) {
          finalScore = refComparison.score * 0.7 + structural.score * 0.3
          finalReason = refComparison.reason
        } else {
          // Reference returned nothing — rely on structural checks
          finalScore = structural.score
          finalReason = structural.reason + (refResult.success ? '' : ` [Reference SQL error: ${refResult.error}]`)
        }
      }
    } catch (err: unknown) {
      finalScore = 0
      finalReason = `Exception: ${(err as Error).message}`
    }

    const pass = finalScore >= 0.7
    yield {
      type: 'query_result',
      id: q.id, pass, score: Math.round(finalScore * 100) / 100,
      reason: finalReason, sql: agentSQL,
      refRowCount: refRows.length, agentRowCount,
    }
    results.push({
      id: q.id, question: q.question, difficulty: q.difficulty,
      pass, score: Math.round(finalScore * 100) / 100,
      reason: finalReason, sql: agentSQL,
      refRowCount: refRows.length, agentRowCount,
    })
  }

  const overallScore = results.reduce((s, r) => s + r.score, 0) / results.length
  const passed = results.filter(r => r.pass).length
  yield { type: 'done', overallScore, passed, total: results.length, results }
}
