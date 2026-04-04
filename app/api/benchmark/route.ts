import { NextRequest } from 'next/server'
import { runBenchmark } from '@/lib/benchmark'
import { getCurrentPrompt } from '@/lib/gepa'

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const queryIds: string[] | undefined = body.queryIds
  const systemPrompt: string = body.systemPrompt ?? getCurrentPrompt()

  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: object) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))
      try {
        for await (const event of runBenchmark(systemPrompt, queryIds)) {
          send(event)
        }
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
