import { NextRequest } from 'next/server'
import { getTablePage } from '@/lib/db'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const table = searchParams.get('table') ?? ''
  const page = parseInt(searchParams.get('page') ?? '0', 10)
  const pageSize = parseInt(searchParams.get('pageSize') ?? '50', 10)
  if (!table) return Response.json({ error: 'table param required' }, { status: 400 })
  return Response.json(getTablePage(table, page, pageSize))
}
