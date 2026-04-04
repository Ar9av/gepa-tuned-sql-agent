import { NextRequest } from 'next/server'
import { connectDB, getActiveConfig, type DBConfig } from '@/lib/connector'
import { extractSchemaGraph } from '@/lib/schema-extractor'
import { setCurrentPrompt, resetOptimizer } from '@/lib/gepa'
import { getConnection, upsertConnection } from '@/lib/connection-store'

export async function POST(req: NextRequest) {
  const { connectionId, config } = (await req.json()) as { connectionId?: string; config?: DBConfig }

  let dbConfig: DBConfig

  if (connectionId) {
    // Connect by saved connection ID — credentials are server-side only
    const stored = getConnection(connectionId)
    if (!stored) return Response.json({ ok: false, error: 'Connection not found' }, { status: 404 })
    dbConfig = {
      type: stored.type,
      name: stored.name,
      connectionString: stored.connectionString,
      filename: stored.filename,
    }

    // Load saved GEPA prompt
    resetOptimizer()
    if (stored.savedPrompt) setCurrentPrompt(stored.savedPrompt)
  } else if (config) {
    // Direct config (new connection, credentials sent once to create)
    if (!config.type || !config.name) {
      return Response.json({ ok: false, error: 'Invalid config' }, { status: 400 })
    }
    dbConfig = config
    resetOptimizer()
  } else {
    return Response.json({ ok: false, error: 'connectionId or config required' }, { status: 400 })
  }

  const result = await connectDB(dbConfig)
  if (!result.ok) {
    return Response.json({ ok: false, error: result.error })
  }

  // Update last connected timestamp
  if (connectionId) {
    const stored = getConnection(connectionId)
    if (stored) upsertConnection({ ...stored, lastConnected: Date.now() })
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
    config: config ? { type: config.type, name: config.name } : null, // never expose credentials
  })
}
