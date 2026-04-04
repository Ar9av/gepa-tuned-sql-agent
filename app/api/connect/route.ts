import { NextRequest } from 'next/server'
import { connectDB, getActiveConfig, type DBConfig } from '@/lib/connector'
import { extractSchemaGraph } from '@/lib/schema-extractor'
import { setCurrentPrompt, resetOptimizer } from '@/lib/gepa'

export async function POST(req: NextRequest) {
  const { config, savedPrompt } = (await req.json()) as { config: DBConfig; savedPrompt?: string }

  if (!config?.type || !config?.name) {
    return Response.json({ ok: false, error: 'Invalid config' }, { status: 400 })
  }

  const result = await connectDB(config)

  if (!result.ok) {
    return Response.json({ ok: false, error: result.error })
  }

  // Reset GEPA and load saved prompt for this DB (if any)
  resetOptimizer()
  if (savedPrompt) {
    setCurrentPrompt(savedPrompt)
  }

  try {
    const schemaGraph = await extractSchemaGraph()
    const tables = schemaGraph.tables.map(t => ({ name: t.name, rows: t.rowCount }))
    return Response.json({ ok: true, schemaGraph, tables })
  } catch (err) {
    return Response.json({ ok: true, schemaGraph: { tables: [], edges: [] }, tables: [], error: (err as Error).message })
  }
}

export async function GET() {
  const config = getActiveConfig()
  return Response.json({
    connected: config !== null,
    config,
  })
}
