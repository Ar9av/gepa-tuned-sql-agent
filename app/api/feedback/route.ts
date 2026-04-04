import { NextRequest } from 'next/server'
import { recordResult, shouldOptimize, runOptimizationCycle, getParetoFront, getCurrentPrompt } from '@/lib/gepa'
import { runBenchmark } from '@/lib/benchmark'
import { complete } from '@/lib/llm'

// Module-level wrong streak tracker
let wrongStreak = 0
let previousPrompt = ''

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

  const shouldRun = shouldOptimize() || wrongStreak >= 2

  if (!shouldRun) {
    return Response.json({ recorded: true, optimized: false })
  }

  // Reset wrong streak
  if (wrongStreak >= 2) wrongStreak = 0

  // Save the old prompt for diff summary
  previousPrompt = getCurrentPrompt()

  // Stream GEPA progress as SSE
  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: object) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))

      try {
        // Step 1: Reflect
        send({ type: 'gepa_status', step: 'reflecting', message: 'Analyzing failure patterns...' })
        const optimizationResult = await runOptimizationCycle()

        if (!optimizationResult) {
          send({ type: 'done', recorded: true, optimized: false })
          controller.close()
          return
        }

        send({ type: 'gepa_status', step: 'mutated', message: 'New prompt generated' })

        // Step 2: Benchmark
        send({ type: 'gepa_status', step: 'benchmarking', message: 'Scoring new prompt against benchmark...' })

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
          // use fallback score
        }

        // Step 3: Generate diff summary
        send({ type: 'gepa_status', step: 'summarizing', message: 'Summarizing changes...' })

        const diffSummary = await complete(
          `You compare two system prompts for a SQL generation agent. Describe what changed in 2-3 concise bullet points. Focus on what specific rules were added or removed, and why (based on the reflection). Use past tense. Do NOT reproduce the full prompts.`,
          `BEFORE prompt:\n${previousPrompt}\n\n---\n\nAFTER prompt:\n${optimizationResult.newPrompt}\n\n---\n\nReflection that drove the change:\n${optimizationResult.reflection}`
        )

        void rowCount // acknowledged

        send({
          type: 'done',
          recorded: true,
          optimized: true,
          gepaRun: {
            generation,
            score,
            reflection: optimizationResult.reflection,
            newPrompt: optimizationResult.newPrompt,
            previousPrompt,
            diffSummary,
          },
        })
      } catch (err: unknown) {
        send({ type: 'error', message: (err as Error).message })
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
