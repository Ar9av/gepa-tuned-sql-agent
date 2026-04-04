import { NextRequest } from 'next/server'
import { recordResult, shouldOptimize, runOptimizationCycle, getParetoFront } from '@/lib/gepa'
import { runBenchmark } from '@/lib/benchmark'

// Module-level wrong streak tracker
let wrongStreak = 0

export async function POST(req: NextRequest) {
  const { correct, question, sql, rowCount } = (await req.json()) as {
    correct: boolean
    question: string
    sql: string
    rowCount: number
  }

  // Record result in GEPA
  recordResult({
    question,
    finalSQL: sql,
    attempts: 1,
    success: correct,
    errors: correct ? [] : ['User marked as incorrect'],
    timestamp: Date.now(),
  })

  // Track wrong streak
  if (!correct) {
    wrongStreak++
  } else {
    wrongStreak = 0
  }

  const shouldRun = shouldOptimize() || wrongStreak >= 3

  if (!shouldRun) {
    return Response.json({ recorded: true, optimized: false })
  }

  // Reset wrong streak
  if (wrongStreak >= 3) wrongStreak = 0

  const optimizationResult = await runOptimizationCycle()
  if (!optimizationResult) {
    return Response.json({ recorded: true, optimized: false })
  }

  // Run mini-benchmark to get real score
  let score = 0
  let generation = 1
  const front = getParetoFront()
  if (front.length > 0) {
    generation = Math.max(...front.map(c => c.generation))
    score = front.reduce((a, b) => (a.score > b.score ? a : b)).score
  }

  try {
    for await (const event of runBenchmark(optimizationResult.newPrompt, ['gq-01', 'gq-02', 'gq-03', 'gq-04', 'gq-05'])) {
      if (event.type === 'done') {
        score = event.overallScore
      }
    }
  } catch {
    // use fallback score from pareto front
  }

  void rowCount // acknowledged

  return Response.json({
    recorded: true,
    optimized: true,
    gepaRun: {
      generation,
      score,
      reflection: optimizationResult.reflection,
      newPrompt: optimizationResult.newPrompt,
    },
  })
}
