'use client'

import { useEffect, useState } from 'react'
import { useDemoStore } from '@/store/demo-store'
import { ChevronLeft, ChevronRight, Table2, Loader2, Search, ChevronDown } from 'lucide-react'

const PAGE_SIZE = 10

interface TableData {
  rows: Record<string, unknown>[]
  totalCount: number
  columns: string[]
}

export function TableBrowser() {
  const { tableStats, selectedTable, tableBrowserPage, setSelectedTable, setTableBrowserPage } = useDemoStore()
  const [data, setData] = useState<TableData | null>(null)
  const [loading, setLoading] = useState(false)
  const [filter, setFilter] = useState('')
  const [mobileTableOpen, setMobileTableOpen] = useState(false)

  const tables = tableStats.filter(t => !t.name.startsWith('sqlite_'))

  useEffect(() => {
    if (!selectedTable && tables.length > 0) setSelectedTable(tables[0].name)
  }, [tables.length])

  // Reset filter when table changes
  useEffect(() => {
    setFilter('')
  }, [selectedTable])

  useEffect(() => {
    if (!selectedTable) return
    setLoading(true)
    fetch(`/api/table-data?table=${encodeURIComponent(selectedTable)}&page=${tableBrowserPage}&pageSize=${PAGE_SIZE}`)
      .then(r => r.json())
      .then((d: TableData) => { setData(d); setLoading(false) })
      .catch(() => setLoading(false))
  }, [selectedTable, tableBrowserPage])

  if (tables.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-gray-600 gap-3">
        <Table2 size={32} className="text-gray-800" />
        <p className="text-sm">Generate and populate a schema first</p>
      </div>
    )
  }

  const filteredRows = data
    ? filter.trim()
      ? data.rows.filter(row =>
          data.columns.some(col => {
            const val = row[col]
            return val != null && String(val).toLowerCase().includes(filter.toLowerCase())
          })
        )
      : data.rows
    : []

  const totalPages = data ? Math.ceil(data.totalCount / PAGE_SIZE) : 0
  const startRow = tableBrowserPage * PAGE_SIZE + 1
  const endRow = Math.min((tableBrowserPage + 1) * PAGE_SIZE, data?.totalCount ?? 0)

  return (
    <div className="flex flex-col md:flex-row h-full">
      {/* Mobile: table selector dropdown */}
      <div className="md:hidden shrink-0 border-b border-white/5 p-2">
        <button
          onClick={() => setMobileTableOpen(!mobileTableOpen)}
          className="w-full flex items-center justify-between px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-xs font-mono text-violet-300"
        >
          <span>{selectedTable ?? 'Select table'}</span>
          <ChevronDown size={12} className={`text-gray-500 transition-transform ${mobileTableOpen ? 'rotate-180' : ''}`} />
        </button>
        {mobileTableOpen && (
          <div className="mt-1 max-h-48 overflow-y-auto rounded-lg border border-white/10 bg-[#0d0d14]">
            {tables.map(t => (
              <button key={t.name} onClick={() => { setSelectedTable(t.name); setMobileTableOpen(false) }}
                className={`w-full flex items-center justify-between px-3 py-2 text-left text-xs font-mono transition-colors
                  ${selectedTable === t.name ? 'bg-violet-600/20 text-violet-300' : 'text-gray-400 hover:bg-white/5'}`}>
                <span className="truncate">{t.name}</span>
                <span className="text-[10px] text-gray-600 tabular-nums ml-2 shrink-0">{t.rows.toLocaleString()}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Desktop: left table list */}
      <div className="hidden md:flex w-44 shrink-0 border-r border-white/5 overflow-y-auto p-2 flex-col gap-0.5">
        {tables.map(t => (
          <button key={t.name} onClick={() => { setSelectedTable(t.name) }}
            className={`w-full flex items-center justify-between px-2.5 py-2 rounded-lg text-left transition-all
              ${selectedTable === t.name ? 'bg-violet-600/20 text-violet-300 border border-violet-500/30' : 'text-gray-400 hover:bg-white/5 hover:text-gray-300 border border-transparent'}`}>
            <span className="text-xs font-mono truncate">{t.name}</span>
            <span className="text-[10px] text-gray-600 tabular-nums ml-1 shrink-0">{t.rows.toLocaleString()}</span>
          </button>
        ))}
      </div>

      {/* Right: data grid */}
      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        {/* Top bar */}
        <div className="flex items-center justify-between px-3 sm:px-4 py-2.5 border-b border-white/5 shrink-0 gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-xs font-mono text-violet-300 font-semibold truncate">{selectedTable}</span>
            {data && <span className="text-xs text-gray-600 shrink-0">{data.totalCount.toLocaleString()} rows</span>}
          </div>
          {loading && <Loader2 size={13} className="text-violet-400 animate-spin shrink-0" />}
          <div className="relative shrink-0">
            <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-600" />
            <input
              type="text"
              placeholder="Filter..."
              value={filter}
              onChange={e => setFilter(e.target.value)}
              className="pl-7 pr-2 py-1 rounded-md bg-white/5 border border-white/10 text-xs text-gray-300 placeholder-gray-600 focus:outline-none focus:border-violet-500/50 w-28 sm:w-48"
            />
          </div>
        </div>

        {/* Table */}
        <div className="flex-1 overflow-auto">
          {data && filteredRows.length > 0 ? (
            <table className="w-full text-xs border-collapse">
              <thead className="sticky top-0 z-10">
                <tr className="bg-[#0a0a0f]">
                  {data.columns.map(col => (
                    <th key={col} className="text-left px-3 py-2 text-gray-500 font-mono font-medium whitespace-nowrap border-b border-white/5 bg-white/3">
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredRows.map((row, i) => (
                  <tr key={i} className={`border-b border-white/5 hover:bg-white/3 transition-colors ${i % 2 === 0 ? '' : 'bg-white/[0.01]'}`}>
                    {data.columns.map(col => (
                      <td key={col} className="px-3 py-1.5 font-mono whitespace-nowrap max-w-48">
                        {row[col] === null || row[col] === undefined
                          ? <span className="text-gray-700 italic text-[10px]">NULL</span>
                          : <span className="text-gray-300 truncate block">{String(row[col])}</span>}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          ) : !loading && (
            <div className="flex items-center justify-center h-32 text-gray-600 text-sm">No data in this table</div>
          )}
        </div>

        {/* Pagination */}
        {data && data.totalCount > PAGE_SIZE && (
          <div className="flex items-center justify-between px-3 sm:px-4 py-2.5 border-t border-white/5 shrink-0">
            <span className="text-xs text-gray-600">
              <span className="hidden sm:inline">Rows </span>{startRow}–{endRow} of {data.totalCount.toLocaleString()}
            </span>
            <div className="flex items-center gap-1">
              <button onClick={() => setTableBrowserPage(Math.max(0, tableBrowserPage - 1))}
                disabled={tableBrowserPage === 0}
                className="p-1.5 rounded-lg hover:bg-white/5 disabled:opacity-30 transition-colors">
                <ChevronLeft size={13} className="text-gray-400" />
              </button>
              <span className="text-xs text-gray-500 px-2">{tableBrowserPage + 1}/{totalPages}</span>
              <button onClick={() => setTableBrowserPage(Math.min(totalPages - 1, tableBrowserPage + 1))}
                disabled={tableBrowserPage >= totalPages - 1}
                className="p-1.5 rounded-lg hover:bg-white/5 disabled:opacity-30 transition-colors">
                <ChevronRight size={13} className="text-gray-400" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
