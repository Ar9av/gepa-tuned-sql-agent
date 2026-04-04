import OpenAI from 'openai'

export const llm = new OpenAI({
  apiKey: process.env.AZURE_API_KEY!,
  baseURL: process.env.AZURE_BASE_URL!,
  defaultQuery: { 'api-version': '2024-05-01-preview' },
  defaultHeaders: { 'Authorization': `Bearer ${process.env.AZURE_API_KEY}` },
})

export const MODEL = process.env.AZURE_MODEL ?? 'grok-4-1-fast-reasoning'

export async function complete(system: string, user: string): Promise<string> {
  const res = await llm.chat.completions.create({
    model: MODEL,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    temperature: 0.2,
  })
  return res.choices[0].message.content ?? ''
}

export async function* stream(system: string, user: string): AsyncGenerator<string> {
  const res = await llm.chat.completions.create({
    model: MODEL,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    temperature: 0.2,
    stream: true,
  })
  for await (const chunk of res) {
    const delta = chunk.choices[0]?.delta?.content
    if (delta) yield delta
  }
}
