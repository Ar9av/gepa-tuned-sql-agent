'use client'

import { useState, useCallback, KeyboardEvent } from 'react'
import { useDemoStore } from '@/store/demo-store'
import { Play, Copy, Check, Clock, AlertCircle, Database } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'

export function SQLPlayground() {
  const { tableStats, playgroundSQL, playgroundResult, playgroundRunning,
    setPlaygroundSQL, setPlaygroundResult, setPlaygroundRunning } = useDemoStore()
  const [copied, setCopied] = useState(false)

  const tables = tableStats.filter(t => !t.name.startsWith('sqlite_'))

  async function runSQL() {
    if (!playgroundSQL.trim() || playgroundRunning) return
    setPlaygroundRunning(true)
    try {
      const res = await fetch('/api/execute-sql', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sql: playgroundSQL }),
      })
      const data = await res.json()
      setPlaygroundResult(data)
    } catch (e: unknown) {
      setPlaygroundResult({ success: false, rows: [], rowCount: 0, error: (e as Error).message })
    } finally {
      setPlaygroundRunning(false)
    }
  }

  function handleKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); runSQL() }
  }

  function copySQL() {
    navigator.clipboard.writeText(playgroundSQL)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  function insertTableSelect(tableName: string) {
    setPlaygroundSQL(`SELECT *\nFROM ${tableName}\nLIMIT 100;`)
  }

  const result = playgroundResult
  const cols = result?.rows?.[0] ? Object.keys(result.rows[0]) : []

  return (
    <div className="flex flex-col h-full">
      {/* Quick table buttons */}
      {tables.length > 0 && (
        <div className="flex items-center gap-1.5 px-4 py-2.5 border-b border-white/5 overflow-x-auto shrink-0">
          <span className="text-[10px] text-gray-600 shrink-0">Quick select:</span>
          {tables.map(t => (
            <button key={t.name} onClick={() => insertTableSelect(t.name)}
              className="shrink-0 text-[10px] font-mono px-2 py-1 rounded-md bg-white/5 hover:bg-white/10 text-gray-400 hover:text-gray-200 border border-white/5 transition-all">
              {t.name}
            </button>
          ))}
        </div>
      )}

      {/* Editor */}
      <div className="relative shrink-0 border-b border-white/5">
        <textarea
          value={playgroundSQL}
          onChange={e => setPlaygroundSQL(e.target.value)}
          onKeyDown={handleKey}
          spellCheck={false}
          placeholder={tables.length === 0 ? 'Generate a schema first...' : 'Write SQL here... (⌘+Enter to run)'}
          disabled={tables.length === 0}
          className="w-full bg-transparent font-mono text-xs text-gray-200 placeholder-gray-700 resize-none outline-none p-4 leading-relaxed min-h-[160px]"
          rows={8}
        />
        {/* Run + Copy buttons */}
        <div className="absolute bottom-3 right-3 flex items-center gap-2">
          <button onClick={copySQL} disabled={!playgroundSQL}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-gray-400 hover:text-gray-200 text-[10px] transition-all disabled:opacity-30">
            {copied ? <Check size={10} className="text-green-400" /> : <Copy size={10} />}
            {copied ? 'Copied' : 'Copy'}
          </button>
          <button onClick={runSQL} disabled={!playgroundSQL.trim() || playgroundRunning || tables.length === 0}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-[10px] font-semibold transition-all disabled:opacity-40 disabled:cursor-not-allowed">
            <Play size={10} />
            Run
          </button>
        </div>
      </div>

      {/* Results */}
      <div className="flex-1 overflow-auto">
        <AnimatePresence mode="wait">
          {playgroundRunning && (
            <motion.div key="loading" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="flex items-center justify-center h-24 gap-2 text-gray-600 text-xs">
              <div className="w-1.5 h-1.5 rounded-full bg-violet-500 animate-bounce" style={{ animationDelay: '0ms' }} />
              <div className="w-1.5 h-1.5 rounded-full bg-violet-500 animate-bounce" style={{ animationDelay: '150ms' }} />
              <div className="w-1.5 h-1.5 rounded-full bg-violet-500 animate-bounce" style={{ animationDelay: '300ms' }} />
            </motion.div>
          )}

          {!playgroundRunning && result && (
            <motion.div key="result" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col">
              {/* Result header */}
              <div className={`flex items-center justify-between px-4 py-2 border-b border-white/5 ${result.success ? 'bg-green-500/5' : 'bg-red-500/5'}`}>
                <div className="flex items-center gap-2">
                  {result.success
                    ? <div className="w-1.5 h-1.5 rounded-full bg-green-400" />
                    : <AlertCircle size={12} className="text-red-400" />}
                  <span className={`text-xs font-medium ${result.success ? 'text-green-400' : 'text-red-400'}`}>
                    {result.success ? `${result.rowCount} rows returned` : 'Query failed'}
                  </span>
                </div>
                {result.timeMs !== undefined && (
                  <div className="flex items-center gap-1 text-[10px] text-gray-600">
                    <Clock size={9} />
                    {result.timeMs}ms
                  </div>
                )}
              </div>

              {/* Error */}
              {!result.success && result.error && (
                <div className="px-4 py-3 font-mono text-xs text-red-300 bg-red-500/5 leading-relaxed">
                  {result.error}
                </div>
              )}

              {/* Rows */}
              {result.success && cols.length > 0 && (
                <table className="w-full text-xs border-collapse">
                  <thead className="sticky top-0">
                    <tr>
                      {cols.map(col => (
                        <th key={col} className="text-left px-3 py-2 text-gray-500 font-mono font-medium whitespace-nowrap border-b border-white/5 bg-[#0a0a0f]">
                          {col}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {result.rows.map((row, i) => (
                      <tr key={i} className="border-b border-white/5 hover:bg-white/3 transition-colors">
                        {cols.map(col => (
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
              )}

              {result.success && result.rowCount === 0 && (
                <div className="flex items-center justify-center h-16 text-gray-600 text-xs">Query executed — 0 rows</div>
              )}
            </motion.div>
          )}

          {!playgroundRunning && !result && tables.length > 0 && (
            <motion.div key="empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }}
              className="flex flex-col items-center justify-center h-32 text-gray-700 gap-2">
              <Database size={20} />
              <p className="text-xs">Results will appear here</p>
              <p className="text-[10px] text-gray-800">⌘+Enter to run</p>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  )
}
