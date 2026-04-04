import { NextRequest } from 'next/server'
import { executeQueryAsync, getActiveConfig } from '@/lib/connector'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const table = searchParams.get('table') ?? ''
  const page = parseInt(searchParams.get('page') ?? '0', 10)
  const pageSize = parseInt(searchParams.get('pageSize') ?? '50', 10)

  if (!table) return Response.json({ error: 'table param required' }, { status: 400 })

  const config = getActiveConfig()
  if (!config) return Response.json({ error: 'No database connected' }, { status: 400 })

  // Sanitize table name — allow alphanumeric, underscores, dots (for schema-qualified names)
  const safeTable = table.replace(/[^a-zA-Z0-9_.]/g, '')

  try {
    const countResult = await executeQueryAsync(`SELECT COUNT(*) as n FROM "${safeTable}"`)
    const totalCount = countResult.error
      ? 0
      : Number((countResult.rows[0] as Record<string, unknown>)?.n ?? 0)

    const dataResult = await executeQueryAsync(
      `SELECT * FROM "${safeTable}" LIMIT ${pageSize} OFFSET ${page * pageSize}`
    )

    if (dataResult.error) {
      return Response.json({ rows: [], totalCount: 0, columns: [], error: dataResult.error })
    }

    const rows = dataResult.rows
    let columns: string[] = []

    if (rows.length > 0) {
      columns = Object.keys(rows[0])
    } else {
      // Try to get column names from an empty table
      // For PostgreSQL use information_schema; for others just return empty
      if (config.type === 'postgresql') {
        const colResult = await executeQueryAsync(
          `SELECT column_name FROM information_schema.columns WHERE table_name = '${safeTable}' ORDER BY ordinal_position`
        )
        columns = colResult.rows.map(r => String((r as Record<string, unknown>).column_name))
      } else if (config.type === 'mysql') {
        const colResult = await executeQueryAsync(
          `SELECT column_name FROM information_schema.columns WHERE table_name = '${safeTable}' ORDER BY ordinal_position`
        )
        columns = colResult.rows.map(r => String((r as Record<string, unknown>).COLUMN_NAME ?? (r as Record<string, unknown>).column_name))
      } else {
        const colResult = await executeQueryAsync(`PRAGMA table_info("${safeTable}")`)
        columns = colResult.rows.map(r => String((r as Record<string, unknown>).name))
      }
    }

    return Response.json({ rows, totalCount, columns })
  } catch (err) {
    return Response.json({ rows: [], totalCount: 0, columns: [], error: (err as Error).message })
  }
}
