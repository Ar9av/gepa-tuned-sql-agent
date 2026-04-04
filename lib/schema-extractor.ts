import type { SchemaGraph, TableNode, FKEdge, ColumnMeta } from './db'
import type { Knex } from 'knex'
import { getKnex, getActiveConfig } from './connector'

export async function extractSchemaGraph(): Promise<SchemaGraph> {
  const knexInst = getKnex()
  const config = getActiveConfig()

  if (!knexInst || !config) {
    return { tables: [], edges: [] }
  }

  try {
    if (config.type === 'sqlite') {
      return await extractSQLiteSchema(knexInst)
    } else if (config.type === 'postgresql') {
      return await extractPostgresSchema(knexInst)
    } else {
      return await extractMySQLSchema(knexInst)
    }
  } catch {
    return { tables: [], edges: [] }
  }
}

// Helper: normalize knex.raw result to an array.
// - SQLite (better-sqlite3 via knex): returns the array directly
// - PostgreSQL: returns { rows: [...] }
// - MySQL: returns [rows, fields]
function toRows<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[]
  if (result && typeof result === 'object' && 'rows' in result) {
    return (result as { rows: T[] }).rows ?? []
  }
  return []
}

async function extractSQLiteSchema(knexInst: Knex): Promise<SchemaGraph> {
  const tableRows = toRows<{ name: string }>(
    await knexInst.raw(
      `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`
    )
  )
  const tableNames = tableRows.map(r => r.name)

  const tables: TableNode[] = []
  const edges: FKEdge[] = []

  for (const name of tableNames) {
    const colRows = toRows<{ name: string; type: string; notnull: number; pk: number }>(
      await knexInst.raw(`PRAGMA table_info("${name}")`)
    )
    const columns: ColumnMeta[] = colRows.map(c => ({
      name: c.name,
      type: c.type,
      pk: c.pk > 0,
      notnull: c.notnull > 0,
    }))

    const countRows = toRows<{ n: number }>(
      await knexInst.raw(`SELECT COUNT(*) as n FROM "${name}"`)
    )
    const rowCount = Number(countRows[0]?.n ?? 0)

    tables.push({ name, columns, rowCount })

    const fkRows = toRows<{ table: string; from: string; to: string }>(
      await knexInst.raw(`PRAGMA foreign_key_list("${name}")`)
    )
    for (const fk of fkRows) {
      edges.push({ fromTable: name, fromCol: fk.from, toTable: fk.table, toCol: fk.to })
    }
  }

  return { tables, edges }
}

async function extractPostgresSchema(knexInst: Knex): Promise<SchemaGraph> {
  const tableRows = toRows<{ table_name: string }>(
    await knexInst.raw(
      `SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE' ORDER BY table_name`
    )
  )
  const tableNames = tableRows.map(r => r.table_name)

  const tables: TableNode[] = []
  const edges: FKEdge[] = []

  for (const name of tableNames) {
    const colRows = toRows<{ name: string; type: string; notnull: number; pk: number }>(
      await knexInst.raw(
        `SELECT column_name as name, data_type as type,
         CASE WHEN is_nullable='NO' THEN 1 ELSE 0 END as notnull,
         CASE WHEN column_name IN (
           SELECT column_name FROM information_schema.key_column_usage k
           JOIN information_schema.table_constraints tc ON k.constraint_name=tc.constraint_name
           WHERE tc.constraint_type='PRIMARY KEY' AND k.table_name=? AND k.table_schema='public'
         ) THEN 1 ELSE 0 END as pk
  FROM information_schema.columns
  WHERE table_schema='public' AND table_name=?
  ORDER BY ordinal_position`,
        [name, name]
      )
    )

    const columns: ColumnMeta[] = colRows.map(c => ({
      name: c.name,
      type: c.type,
      pk: Number(c.pk) > 0,
      notnull: Number(c.notnull) > 0,
    }))

    const countRows = toRows<{ n: string | number }>(
      await knexInst.raw(`SELECT COUNT(*) as n FROM "${name}"`)
    )
    const rowCount = Number(countRows[0]?.n ?? 0)

    tables.push({ name, columns, rowCount })
  }

  // Foreign keys
  const fkRows = toRows<{ from_table: string; from_col: string; to_table: string; to_col: string }>(
    await knexInst.raw(
      `SELECT kcu.table_name as from_table, kcu.column_name as from_col,
         ccu.table_name as to_table, ccu.column_name as to_col
  FROM information_schema.table_constraints tc
  JOIN information_schema.key_column_usage kcu ON tc.constraint_name=kcu.constraint_name AND tc.table_schema=kcu.table_schema
  JOIN information_schema.referential_constraints rc ON tc.constraint_name=rc.constraint_name
  JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name=rc.unique_constraint_name
  WHERE tc.constraint_type='FOREIGN KEY' AND tc.table_schema='public'`
    )
  )
  for (const fk of fkRows) {
    edges.push({
      fromTable: fk.from_table,
      fromCol: fk.from_col,
      toTable: fk.to_table,
      toCol: fk.to_col,
    })
  }

  return { tables, edges }
}

async function extractMySQLSchema(knexInst: Knex): Promise<SchemaGraph> {
  // MySQL knex.raw returns [rows, fields]
  const dbResultRaw = await knexInst.raw('SELECT DATABASE() as db')
  const dbResultRows = Array.isArray(dbResultRaw) ? dbResultRaw[0] : toRows(dbResultRaw)
  const dbName: string = (dbResultRows as { db: string }[])[0]?.db ?? ''

  const tableRowsRaw = await knexInst.raw(
    `SELECT TABLE_NAME as table_name FROM information_schema.TABLES WHERE TABLE_SCHEMA=? AND TABLE_TYPE='BASE TABLE' ORDER BY TABLE_NAME`,
    [dbName]
  )
  const tableRows = Array.isArray(tableRowsRaw) ? tableRowsRaw[0] : toRows(tableRowsRaw)
  const tableNames = (tableRows as { table_name: string }[]).map(r => r.table_name)

  const tables: TableNode[] = []
  const edges: FKEdge[] = []

  for (const name of tableNames) {
    const colRowsRaw = await knexInst.raw(
      `SELECT COLUMN_NAME as name, DATA_TYPE as type,
       CASE WHEN IS_NULLABLE='NO' THEN 1 ELSE 0 END as notnull,
       CASE WHEN COLUMN_KEY='PRI' THEN 1 ELSE 0 END as pk
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA=? AND TABLE_NAME=?
ORDER BY ORDINAL_POSITION`,
      [dbName, name]
    )
    const colRows = Array.isArray(colRowsRaw) ? colRowsRaw[0] : toRows(colRowsRaw)
    const columns: ColumnMeta[] = (colRows as { name: string; type: string; notnull: number; pk: number }[]).map(c => ({
      name: c.name,
      type: c.type,
      pk: Number(c.pk) > 0,
      notnull: Number(c.notnull) > 0,
    }))

    const countRaw = await knexInst.raw(`SELECT COUNT(*) as n FROM \`${name}\``)
    const countRows = Array.isArray(countRaw) ? countRaw[0] : toRows(countRaw)
    const rowCount = Number((countRows as { n: string | number }[])[0]?.n ?? 0)

    tables.push({ name, columns, rowCount })

    const fkRaw = await knexInst.raw(
      `SELECT COLUMN_NAME as from_col, REFERENCED_TABLE_NAME as to_table, REFERENCED_COLUMN_NAME as to_col
FROM information_schema.KEY_COLUMN_USAGE
WHERE TABLE_SCHEMA=? AND TABLE_NAME=? AND REFERENCED_TABLE_NAME IS NOT NULL`,
      [dbName, name]
    )
    const fkRows = Array.isArray(fkRaw) ? fkRaw[0] : toRows(fkRaw)
    for (const fk of fkRows as { from_col: string; to_table: string; to_col: string }[]) {
      edges.push({
        fromTable: name,
        fromCol: fk.from_col,
        toTable: fk.to_table,
        toCol: fk.to_col,
      })
    }
  }

  return { tables, edges }
}

export function formatSchemaAsText(schema: SchemaGraph): string {
  if (schema.tables.length === 0) return 'No schema loaded yet.'

  const fkMap = new Map<string, { toTable: string; toCol: string }>()
  for (const edge of schema.edges) {
    fkMap.set(`${edge.fromTable}.${edge.fromCol}`, { toTable: edge.toTable, toCol: edge.toCol })
  }

  return schema.tables.map(t => {
    const colDefs = t.columns.map(c => {
      const fk = fkMap.get(`${t.name}.${c.name}`)
      const flags = [
        c.pk ? 'PK' : '',
        fk ? `FK→${fk.toTable}.${fk.toCol}` : '',
        c.notnull && !c.pk ? 'NOT NULL' : '',
      ].filter(Boolean).join(' ')
      return `  ${c.name} ${c.type}${flags ? ' ' + flags : ''}`
    }).join('\n')
    return `TABLE ${t.name} (${t.rowCount} rows):\n${colDefs}`
  }).join('\n\n')
}
