import { NextRequest } from 'next/server'
import { executeSQL } from '@/lib/db'

export async function POST(req: NextRequest) {
  const { sql } = await req.json()
  if (!sql?.trim()) return Response.json({ error: 'sql required' }, { status: 400 })
  const start = Date.now()
  const result = executeSQL(sql.trim())
  return Response.json({ ...result, timeMs: Date.now() - start })
}
