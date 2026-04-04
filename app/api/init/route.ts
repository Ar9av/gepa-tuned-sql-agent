import { seedBenchmarkDb } from '@/lib/seed'
import { connectDB, getActiveConfig } from '@/lib/connector'
import path from 'path'
import os from 'os'

const DB_PATH = path.join(os.tmpdir(), 'sql-agent-demo.db')

export async function GET() {
  // Seed the benchmark SQLite DB
  const result = seedBenchmarkDb()

  // Auto-connect via the universal connector if not already connected
  if (!getActiveConfig()) {
    await connectDB({
      type: 'sqlite',
      filename: DB_PATH,
      name: 'Benchmark DB',
    })
  }

  return Response.json(result)
}
