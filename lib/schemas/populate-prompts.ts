import type { SchemaGraph } from '@/lib/db'

export function buildPopulatePrompt(graph: SchemaGraph, rowCount: number): string {
  // Build topological insert order
  const deps = new Map<string, Set<string>>()
  for (const t of graph.tables) deps.set(t.name, new Set())
  for (const e of graph.edges) {
    if (e.fromTable !== e.toTable) deps.get(e.fromTable)?.add(e.toTable)
  }
  const visited = new Set<string>()
  const insertOrder: string[] = []
  function visit(name: string) {
    if (visited.has(name)) return
    visited.add(name)
    for (const dep of (deps.get(name) ?? [])) visit(dep)
    insertOrder.push(name)
  }
  for (const t of graph.tables) visit(t.name)

  const schemaDesc = graph.tables.map(t => {
    const fksForTable = graph.edges.filter(e => e.fromTable === t.name)
    const colDesc = t.columns.map(c => {
      const fk = fksForTable.find(e => e.fromCol === c.name)
      return `  ${c.name} ${c.type}${c.pk ? ' PK' : ''}${fk ? ` FK→${fk.toTable}.${fk.toCol}` : ''}`
    }).join('\n')
    return `TABLE ${t.name}:\n${colDesc}`
  }).join('\n\n')

  // Distribute row counts proportionally
  const rootTables = insertOrder.filter(t => !graph.edges.some(e => e.fromTable === t))
  const childTables = insertOrder.filter(t => graph.edges.some(e => e.fromTable === t))
  const rootCount = Math.floor(rowCount / 10)
  const childCount = rowCount

  return `You are a SQLite data generation expert.

Generate INSERT statements to populate the following database with realistic data.

SCHEMA:
${schemaDesc}

INSERT ORDER (you MUST follow this exact order — parents before children):
${insertOrder.join(' → ')}

REQUIREMENTS:
- Target approximately ${rowCount} rows total across all tables
- Root/parent tables (${rootTables.join(', ')}): ~${rootCount} rows each
- Child tables (${childTables.join(', ')}): scale up to ~${childCount} rows combined
- Use SQLite WITH RECURSIVE CTEs for bulk generation — do NOT write individual INSERT rows
- Use realistic, varied data (not just "Item 1", "Item 2" — use real names, emails, dates, amounts)
- For FK columns, reference parent rows using this pattern:
  (SELECT id FROM parent_table LIMIT 1 OFFSET (abs(random()) % MAX(1, (SELECT COUNT(*) FROM parent_table))))
- For date columns, spread across the last 2 years using: date('now', '-' || (abs(random()) % 730) || ' days')
- For status/enum columns, vary values realistically (not all the same)
- SQLite WITH RECURSIVE can safely generate up to 50000 rows

PATTERN TO USE:
WITH RECURSIVE cnt(i) AS (
  SELECT 1 UNION ALL SELECT i+1 FROM cnt WHERE i < N
)
INSERT INTO table_name (col1, col2, ...)
SELECT expr1, expr2, ... FROM cnt;

OUTPUT: ONLY valid SQLite SQL statements. No markdown, no code fences, no explanations.
Separate each major table's INSERT with a blank line and a comment like: -- Populate customers
`
}
