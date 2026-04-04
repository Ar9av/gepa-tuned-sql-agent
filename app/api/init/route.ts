import { seedBenchmarkDb } from '@/lib/seed'

export async function GET() {
  const result = seedBenchmarkDb()
  return Response.json(result)
}
