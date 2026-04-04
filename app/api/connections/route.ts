import { NextRequest } from 'next/server'
import { loadConnections, upsertConnection, deleteConnection, listConnectionsSafe } from '@/lib/connection-store'
import type { StoredConnection } from '@/lib/connection-store'

// GET — list saved connections (credentials masked)
export async function GET() {
  return Response.json({ connections: listConnectionsSafe() })
}

// POST — save a new connection (credentials stay server-side)
export async function POST(req: NextRequest) {
  const conn = (await req.json()) as StoredConnection
  if (!conn.name || !conn.type) {
    return Response.json({ error: 'name and type required' }, { status: 400 })
  }
  if (!conn.id) conn.id = Date.now().toString()
  upsertConnection(conn)
  return Response.json({ ok: true, id: conn.id })
}

// DELETE — remove a saved connection
export async function DELETE(req: NextRequest) {
  const { id } = (await req.json()) as { id: string }
  if (!id) return Response.json({ error: 'id required' }, { status: 400 })
  deleteConnection(id)
  return Response.json({ ok: true })
}
