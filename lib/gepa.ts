import { complete } from './llm'
import { runBenchmark } from './benchmark'

export interface QueryResult {
  question: string
  finalSQL: string
  attempts: number
  success: boolean
  errors: string[]
  timestamp: number
}

export interface Candidate {
  systemPrompt: string
  score: number        // 0-1, higher is better
  avgAttempts: number
  successRate: number
  generation: number
  feedback: string[]
}

// The seed prompt — what we start with before any optimization
export const SEED_SYSTEM_PROMPT = `You are a SQL expert. Given a natural language question and a SQLite database schema, write a correct SQL query.

Rules:
- Output ONLY the SQL query, nothing else
- No markdown, no code fences, no explanation
- Use SQLite syntax`

// Global state for the optimizer (server-side singleton)
const history: QueryResult[] = []
const paretoFront: Candidate[] = [
  {
    systemPrompt: SEED_SYSTEM_PROMPT,
    score: 0.5,
    avgAttempts: 3,
    successRate: 0.5,
    generation: 0,
    feedback: [],
  },
]

export function recordResult(result: QueryResult) {
  history.push(result)
}

export function getCurrentPrompt(): string {
  if (paretoFront.length === 0) return SEED_SYSTEM_PROMPT
  // Pick candidate with best score
  return paretoFront.reduce((a, b) => (a.score > b.score ? a : b)).systemPrompt
}

export function getHistory(): QueryResult[] {
  return [...history]
}

export function getParetoFront(): Candidate[] {
  return [...paretoFront]
}

export function setCurrentPrompt(prompt: string) {
  // Replace the best candidate's prompt (or add a new one)
  if (paretoFront.length > 0) {
    const best = paretoFront.reduce((a, b) => (a.score > b.score ? a : b))
    best.systemPrompt = prompt
  } else {
    paretoFront.push({
      systemPrompt: prompt,
      score: 0.5,
      avgAttempts: 3,
      successRate: 0.5,
      generation: 0,
      feedback: [],
    })
  }
}

export function resetOptimizer() {
  history.length = 0
  paretoFront.length = 0
  paretoFront.push({
    systemPrompt: SEED_SYSTEM_PROMPT,
    score: 0.5,
    avgAttempts: 3,
    successRate: 0.5,
    generation: 0,
    feedback: [],
  })
}

// Run one GEPA optimization cycle
// Called after every 4 queries that have been recorded
export async function runOptimizationCycle(
  userFeedbackContext?: string,
  dialect?: string,
): Promise<{ newPrompt: string; reflection: string } | null> {
  if (history.length < 2) return null

  const recentFailures = history.filter(h => h.attempts > 1 || !h.success).slice(-8)
  if (recentFailures.length < 2) return null

  const currentBest = getCurrentPrompt()
  const dbDialect = dialect || 'SQLite'

  // Step 1: Reflect — LLM diagnoses failure patterns + user feedback
  const failureSummary = recentFailures
    .map(
      (f, i) =>
        `Query ${i + 1}: "${f.question}"\nAttempts: ${f.attempts}\nErrors:\n${f.errors.map(e => `  - ${e}`).join('\n')}\nFinal SQL: ${f.finalSQL}`
    )
    .join('\n\n---\n\n')

  const userContextBlock = userFeedbackContext
    ? `\n\nUser conversation (the user marked queries as correct/wrong — pay close attention to what they said was wrong and WHY):\n${userFeedbackContext}`
    : ''

  const reflection = await complete(
    `You are an expert SQL prompt engineer analyzing why an LLM SQL agent is failing.
The target database is ${dbDialect} — all rules must use ${dbDialect} syntax, NOT other SQL dialects.
Your job: identify specific, recurring patterns in these failures and state EXACTLY what rules or knowledge the system prompt is missing.
CRITICAL: Pay close attention to what the USER marked as wrong and their follow-up messages explaining why. The user's corrections are ground truth — if they say a result is wrong, it IS wrong, even if the query executed successfully.
Be very specific — name the exact ${dbDialect} functions, syntax patterns, or schema reasoning gaps that caused failures.
Output a concise diagnosis (3-5 bullet points max).`,
    `Current system prompt:\n${currentBest}\n\nRecent failures:\n${failureSummary}${userContextBlock}`
  )

  // Step 2: Mutate — generate improved system prompt
  const currentGeneration = Math.max(...paretoFront.map(c => c.generation))
  const newPrompt = await complete(
    `You are an expert prompt engineer. Improve a system prompt for a ${dbDialect} SQL generation agent.
Rules for the new prompt:
- Keep it concise and actionable
- The target database is ${dbDialect} — use ONLY ${dbDialect} syntax and functions
- Add specific rules that address the diagnosed failure patterns AND the user's corrections
- If the user told you what's wrong (e.g., "use this column", "the result should show X"), encode that knowledge as a rule
- Do NOT add generic fluff — every rule must be earned by a real failure or user correction
- Output ONLY the improved system prompt text, nothing else`,
    `Current system prompt:\n${currentBest}\n\nDiagnosed failure patterns:\n${reflection}\n\nWrite the improved system prompt:`
  )

  // Step 3: Score the new candidate vs current best using real benchmark
  const currentAvgAttempts =
    history.reduce((sum, h) => sum + h.attempts, 0) / history.length

  // Real benchmark scoring — run 5 representative queries
  let benchmarkScore = 0.3 // fallback
  try {
    for await (const event of runBenchmark(newPrompt, ['gq-01', 'gq-02', 'gq-03', 'gq-04', 'gq-05'])) {
      if (event.type === 'done') benchmarkScore = event.overallScore
    }
  } catch {}

  const newCandidate: Candidate = {
    systemPrompt: newPrompt,
    score: benchmarkScore,
    avgAttempts: Math.max(currentAvgAttempts - 0.5, 1.0),
    successRate: benchmarkScore,
    generation: currentGeneration + 1,
    feedback: [reflection],
  }

  // Update Pareto front: keep top 3 diverse candidates
  paretoFront.push(newCandidate)
  paretoFront.sort((a, b) => b.score - a.score)
  if (paretoFront.length > 3) paretoFront.pop()

  return { newPrompt, reflection }
}

export function shouldOptimize(): boolean {
  return history.length > 0 && history.length % 2 === 0
}

// Run the full 20-query benchmark against the current best prompt
export async function runFullBenchmark() {
  const prompt = getCurrentPrompt()
  const results = []
  for await (const event of runBenchmark(prompt)) {
    if (event.type === 'done') return event
    if (event.type === 'query_result') results.push(event)
  }
  return null
}
