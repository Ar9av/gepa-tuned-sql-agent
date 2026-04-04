import { llm, MODEL } from '@/lib/llm'

export async function GET() {
  try {
    const res = await llm.chat.completions.create({
      model: MODEL,
      messages: [{ role: 'user', content: 'Reply with just: OK' }],
      max_completion_tokens: 10,
    })
    return Response.json({ ok: true, reply: res.choices[0].message.content })
  } catch (err: unknown) {
    return Response.json({ ok: false, error: (err as Error).message }, { status: 500 })
  }
}
