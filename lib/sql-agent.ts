import { llm, MODEL } from './llm'
import { executeSQL, getSchemaInfo } from './db'
import { getCurrentPrompt, recordResult } from './gepa'
import {
  reset as rlReset,
  observeError,
  selectAction,
  getRepairPrompt,
  recordStep,
  endEpisode,
} from './rl/environment'
import { RepairAction, REPAIR_ACTION_NAMES } from './rl/types'

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
  // RL events — emitted so the UI can visualize bandit decisions
  | { type: 'rl_action'; attempt: number; action: string; errorClass: string; scores: number[] }
  | { type: 'rl_reward'; attempt: number; reward: number; breakdown: Record<string, number> }
  | { type: 'rl_episode_end'; totalReward: number; episodeLength: number; success: boolean }

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

  // Initialize RL episode
  rlReset(question)

  let rlAction: RepairAction | null = null

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    yield { type: 'attempt_start', attempt, maxAttempts: MAX_ATTEMPTS }

    let effectiveSystemPrompt = systemPrompt
    let userMessage: string

    if (attempt === 1) {
      // First attempt — no RL involvement, use base prompt
      userMessage = `Schema:\n${schema}\n\nQuestion: ${question}`
    } else {
      // Retry — RL agent picks the repair strategy
      const obs = observeError(lastError, lastSQL, attempt)
      const { action, actionName, scores } = selectAction()
      rlAction = action

      yield {
        type: 'rl_action',
        attempt,
        action: actionName,
        errorClass: obs.errorClassName,
        scores,
      }

      // Get strategy-specific prompt
      const repair = getRepairPrompt(action, schema, question, lastSQL, lastError)
      effectiveSystemPrompt = systemPrompt + repair.systemSuffix
      userMessage = repair.userMessage
    }

    // Stream SQL generation
    let sql = ''
    const sqlStream = await llm.chat.completions.create({
      model: MODEL,
      messages: [
        { role: 'system', content: effectiveSystemPrompt },
        { role: 'user', content: userMessage },
      ],
      temperature: attempt === 1 ? 0.1 : 0.3,
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
      // Record RL reward for the final step (if this was a retry)
      if (attempt > 1 && rlAction !== null) {
        const { reward, breakdown } = recordStep(rlAction, true, '', sql)
        yield { type: 'rl_reward', attempt, reward, breakdown }
      }

      // End RL episode
      const epResult = endEpisode(true)
      if (epResult) {
        yield {
          type: 'rl_episode_end',
          totalReward: epResult.totalReward,
          episodeLength: epResult.episodeLength,
          success: true,
        }
      }

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

    // Execution failed
    lastError = result.error
    errors.push(result.error)
    yield { type: 'error', attempt, error: result.error }

    // Record RL reward for the failed step (if this was a retry)
    if (attempt > 1 && rlAction !== null) {
      const { reward, breakdown } = recordStep(rlAction, false, result.error, sql)
      yield { type: 'rl_reward', attempt, reward, breakdown }
    }

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

  // All attempts exhausted — end RL episode as failure
  const epResult = endEpisode(false)
  if (epResult) {
    yield {
      type: 'rl_episode_end',
      totalReward: epResult.totalReward,
      episodeLength: epResult.episodeLength,
      success: false,
    }
  }

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
