'use client'

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useDemoStore } from '@/store/demo-store'
import type { SchemaGraph, FKEdge, TableNode } from '@/lib/db'
import { RefreshCw } from 'lucide-react'

const CARD_WIDTH = 220
const HEADER_H = 36
const ROW_H = 24
const COL_GAP = 60
const ROW_GAP = 40

function getCardHeight(table: TableNode) {
  return HEADER_H + table.columns.length * ROW_H + 8
}

function computeLayout(tables: TableNode[]): Map<string, { x: number; y: number; w: number; h: number }> {
  const positions = new Map<string, { x: number; y: number; w: number; h: number }>()
  const COLS = 3
  const colHeights = [0, 0, 0]

  tables.forEach((table, i) => {
    const col = i % COLS
    const x = col * (CARD_WIDTH + COL_GAP)
    const y = colHeights[col]
    const h = getCardHeight(table)
    positions.set(table.name, { x, y, w: CARD_WIDTH, h })
    colHeights[col] += h + ROW_GAP
  })

  return positions
}

interface EdgePath { d: string; key: string; fromTable: string; toTable: string }

function buildEdgePaths(edges: FKEdge[], positions: Map<string, { x: number; y: number; w: number; h: number }>, tables: TableNode[]): EdgePath[] {
  return edges.map(edge => {
    const fromPos = positions.get(edge.fromTable)
    const toPos = positions.get(edge.toTable)
    if (!fromPos || !toPos) return null

    const fromTable = tables.find(t => t.name === edge.fromTable)
    const toTable = tables.find(t => t.name === edge.toTable)
    if (!fromTable || !toTable) return null

    const fromColIdx = fromTable.columns.findIndex(c => c.name === edge.fromCol)
    const toColIdx = toTable.columns.findIndex(c => c.name === edge.toCol)

    const y1 = fromPos.y + HEADER_H + (fromColIdx >= 0 ? fromColIdx : 0) * ROW_H + ROW_H / 2
    const y2 = toPos.y + HEADER_H + (toColIdx >= 0 ? toColIdx : 0) * ROW_H + ROW_H / 2

    let x1: number, x2: number, cx1: number, cx2: number

    if (fromPos.x < toPos.x) {
      // from is left of to
      x1 = fromPos.x + fromPos.w
      x2 = toPos.x
      cx1 = x1 + 60
      cx2 = x2 - 60
    } else if (fromPos.x > toPos.x) {
      // from is right of to
      x1 = fromPos.x
      x2 = toPos.x + toPos.w
      cx1 = x1 - 60
      cx2 = x2 + 60
    } else {
      // same column — vertical routing
      x1 = fromPos.x + fromPos.w / 2
      x2 = toPos.x + toPos.w / 2
      cx1 = x1 + 80
      cx2 = x2 + 80
    }

    return {
      d: `M ${x1} ${y1} C ${cx1} ${y1} ${cx2} ${y2} ${x2} ${y2}`,
      key: `${edge.fromTable}.${edge.fromCol}->${edge.toTable}.${edge.toCol}`,
      fromTable: edge.fromTable,
      toTable: edge.toTable,
    }
  }).filter(Boolean) as EdgePath[]
}

function TableCard({
  table, pos, fkCols, isHovered, isRelated,
  onMouseEnter, onMouseLeave,
}: {
  table: TableNode
  pos: { x: number; y: number; w: number; h: number }
  fkCols: Set<string>
  isHovered: boolean
  isRelated: boolean
  onMouseEnter: () => void
  onMouseLeave: () => void
}) {
  return (
    <div
      style={{ position: 'absolute', left: pos.x, top: pos.y, width: pos.w }}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      className={`rounded-xl border overflow-hidden transition-all duration-150 select-none
        ${isHovered ? 'border-violet-500/80 shadow-lg shadow-violet-500/10 z-10' : isRelated ? 'border-violet-500/40' : 'border-white/10'}
        bg-[#0e0e16]`}
    >
      {/* Header */}
      <div className={`px-3 py-2 flex items-center justify-between transition-colors ${isHovered ? 'bg-violet-600/30' : 'bg-white/5'}`}>
        <span className="text-xs font-bold font-mono text-white">{table.name}</span>
        <span className="text-[10px] text-gray-500 tabular-nums">{table.rowCount.toLocaleString()}</span>
      </div>
      {/* Columns */}
      {table.columns.map(col => (
        <div key={col.name}
          style={{ height: ROW_H }}
          className="flex items-center gap-1.5 px-3 border-t border-white/5 text-[11px] font-mono">
          {col.pk && <span className="text-yellow-400 font-bold text-[9px] w-4 shrink-0">PK</span>}
          {!col.pk && fkCols.has(col.name) && <span className="text-blue-400 font-bold text-[9px] w-4 shrink-0">FK</span>}
          {!col.pk && !fkCols.has(col.name) && <span className="w-4 shrink-0" />}
          <span className={col.pk ? 'text-yellow-300' : fkCols.has(col.name) ? 'text-blue-300' : 'text-gray-400'}>
            {col.name}
          </span>
          <span className="text-gray-700 ml-auto text-[10px]">{col.type.split('(')[0]}</span>
        </div>
      ))}
    </div>
  )
}

export function ERDiagram() {
  const { schemaGraph, setSchemaGraph, tableStats } = useDemoStore()
  const [hoveredTable, setHoveredTable] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  async function fetchGraph() {
    setLoading(true)
    const res = await fetch('/api/schema-graph')
    const g: SchemaGraph = await res.json()
    setSchemaGraph(g)
    setLoading(false)
  }

  useEffect(() => {
    if (!schemaGraph && tableStats.length > 0) fetchGraph()
  }, [tableStats])

  if (tableStats.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-gray-600 gap-3">
        <Database size={32} className="text-gray-800" />
        <p className="text-sm">Generate a schema to see the ER diagram</p>
      </div>
    )
  }

  if (loading || !schemaGraph) {
    return (
      <div className="flex items-center justify-center h-full text-gray-600 gap-2">
        <RefreshCw size={16} className="animate-spin" />
        <span className="text-sm">Loading schema...</span>
      </div>
    )
  }

  const { tables, edges } = schemaGraph
  const positions = computeLayout(tables)
  const edgePaths = buildEdgePaths(edges, positions, tables)

  // SVG canvas size
  const maxX = Math.max(...[...positions.values()].map(p => p.x + p.w)) + COL_GAP
  const maxY = Math.max(...[...positions.values()].map(p => p.y + p.h)) + ROW_GAP

  // FK column sets per table
  const fkColsByTable = new Map<string, Set<string>>()
  for (const e of edges) {
    if (!fkColsByTable.has(e.fromTable)) fkColsByTable.set(e.fromTable, new Set())
    fkColsByTable.get(e.fromTable)!.add(e.fromCol)
  }

  // Related tables for hover
  const relatedTables = hoveredTable
    ? new Set([hoveredTable, ...edges.filter(e => e.fromTable === hoveredTable || e.toTable === hoveredTable).flatMap(e => [e.fromTable, e.toTable])])
    : null

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-white/5">
        <div className="text-xs text-gray-500">{tables.length} tables · {edges.length} relationships</div>
        <button onClick={fetchGraph} className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-300 transition-colors">
          <RefreshCw size={11} />
          Refresh
        </button>
      </div>

      <div ref={containerRef} className="flex-1 overflow-auto p-6 relative">
        <div style={{ position: 'relative', width: maxX, height: maxY }}>
          {/* SVG edge layer */}
          <svg
            style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
            width={maxX} height={maxY}
          >
            <defs>
              <marker id="fk-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
                <path d="M0,0 L8,4 L0,8 Z" fill="#8b5cf6" opacity="0.8" />
              </marker>
              <marker id="fk-arrow-dim" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
                <path d="M0,0 L8,4 L0,8 Z" fill="#4c1d95" opacity="0.3" />
              </marker>
            </defs>
            {edgePaths.map(ep => {
              const isActive = !hoveredTable || relatedTables?.has(ep.fromTable) || relatedTables?.has(ep.toTable)
              return (
                <path
                  key={ep.key}
                  d={ep.d}
                  fill="none"
                  stroke={isActive ? '#8b5cf6' : '#2d1b69'}
                  strokeWidth={isActive ? 1.5 : 1}
                  opacity={isActive ? 0.7 : 0.2}
                  markerEnd={isActive ? 'url(#fk-arrow)' : 'url(#fk-arrow-dim)'}
                  strokeDasharray={isActive ? 'none' : '4 4'}
                />
              )
            })}
          </svg>

          {/* Table cards */}
          {tables.map(table => {
            const pos = positions.get(table.name)!
            const isHov = hoveredTable === table.name
            const isRel = !!hoveredTable && !!relatedTables?.has(table.name) && !isHov
            return (
              <TableCard
                key={table.name}
                table={table}
                pos={pos}
                fkCols={fkColsByTable.get(table.name) ?? new Set()}
                isHovered={isHov}
                isRelated={isRel}
                onMouseEnter={() => setHoveredTable(table.name)}
                onMouseLeave={() => setHoveredTable(null)}
              />
            )
          })}
        </div>
      </div>
    </div>
  )
}

// Needed for the import in db.ts reference in component
import { Database } from 'lucide-react'
