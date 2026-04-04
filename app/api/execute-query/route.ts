import { NextRequest } from 'next/server'
import { runSQLAgent } from '@/lib/sql-agent'
import { shouldOptimize, runOptimizationCycle } from '@/lib/gepa'

export async function POST(req: NextRequest) {
  const { question } = await req.json()
  if (!question?.trim()) {
    return new Response('Question required', { status: 400 })
  }

  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: object) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))
      }

      try {
        // Run the self-debugging agent
        for await (const event of runSQLAgent(question)) {
          send(event)
        }

        // After the query, check if GEPA should optimize
        if (shouldOptimize()) {
          send({ type: 'optimization_start' })
          const result = await runOptimizationCycle()
          if (result) {
            send({
              type: 'optimization_done',
              reflection: result.reflection,
              newPrompt: result.newPrompt,
            })
          }
        }
      } catch (err: unknown) {
        send({ type: 'agent_error', message: (err as Error).message })
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
