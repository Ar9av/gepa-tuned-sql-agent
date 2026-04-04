'use client'

import { useDemoStore } from '@/store/demo-store'
import { Table2, CheckCircle2, XCircle } from 'lucide-react'

export function ResultsTable() {
  const { queryHistory } = useDemoStore()

  if (queryHistory.length === 0) return null

  const last = queryHistory[queryHistory.length - 1]
  if (!last.success || !last.rows?.length) {
    return (
      <div className="flex items-center gap-2 text-red-400 text-xs bg-red-500/10 rounded-xl px-3 py-2.5 border border-red-500/20">
        <XCircle size={13} />
        Query failed after {last.attempts.length} attempts
      </div>
    )
  }

  const cols = Object.keys(last.rows[0])
  const preview = last.rows.slice(0, 10)

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-green-400 text-xs font-medium">
          <CheckCircle2 size={12} />
          {last.rowCount} row{last.rowCount !== 1 ? 's' : ''} returned in {last.attempts.length} attempt{last.attempts.length !== 1 ? 's' : ''}
        </div>
        {last.rowCount! > 10 && (
          <span className="text-xs text-gray-500">showing first 10</span>
        )}
      </div>

      <div className="overflow-x-auto rounded-xl border border-white/10">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-white/10 bg-white/5">
              {cols.map(col => (
                <th key={col} className="text-left px-3 py-2 text-gray-400 font-medium font-mono whitespace-nowrap">
                  {col}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {preview.map((row, i) => (
              <tr key={i} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                {cols.map(col => (
                  <td key={col} className="px-3 py-2 text-gray-300 font-mono whitespace-nowrap max-w-48 truncate">
                    {row[col] === null ? <span className="text-gray-600">NULL</span> : String(row[col])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Final SQL */}
      {last.finalSQL && (
        <div>
          <div className="text-xs text-gray-500 mb-1.5 flex items-center gap-1">
            <Table2 size={11} />
            Final SQL
          </div>
          <pre className="text-xs font-mono text-blue-200/70 bg-black/30 rounded-xl p-3 overflow-x-auto whitespace-pre-wrap border border-white/5">
            {last.finalSQL}
          </pre>
        </div>
      )}
    </div>
  )
}
