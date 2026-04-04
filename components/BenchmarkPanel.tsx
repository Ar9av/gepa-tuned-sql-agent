'use client'

import { useState, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Target, Play, Loader2, CheckCircle2, XCircle, ChevronDown, RotateCcw } from 'lucide-react'
import { useDemoStore } from '@/store/demo-store'
import type { BenchmarkQueryResult } from '@/store/demo-store'

export function BenchmarkPanel() {
  const {
    benchmarkResults, benchmarkRunning, benchmarkScore, activeBenchmarkId, dbSeeded,
    setBenchmarkRunning, updateBenchmarkResult, setBenchmarkScore, setActiveBenchmarkId, resetBenchmark,
  } = useDemoStore()

  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())

  const toggleExpand = useCallback((id: string) => {
    setExpandedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const runBenchmark = useCallback(async (queryIds?: string[]) => {
    if (benchmarkRunning) return

    setBenchmarkRunning(true)

    // Set targeted queries to 'running'
    const targetIds = queryIds ?? benchmarkResults.map(r => r.id)
    for (const id of targetIds) {
      const existing = benchmarkResults.find(r => r.id === id)
      if (existing) {
        updateBenchmarkResult({ ...existing, status: 'running', score: null, reason: null, sql: null })
      }
    }

    try {
      const body: Record<string, unknown> = {}
      if (queryIds) body.queryIds = queryIds

      const res = await fetch('/api/benchmark', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })

      const reader = res.body!.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          try {
            const event = JSON.parse(line.slice(6))

            if (event.type === 'query_start') {
              setActiveBenchmarkId(event.id)
              const existing = benchmarkResults.find(r => r.id === event.id)
              if (existing) {
                updateBenchmarkResult({ ...existing, status: 'running' })
              }
            }

            if (event.type === 'query_result') {
              const existing = benchmarkResults.find(r => r.id === event.id)
              if (existing) {
                updateBenchmarkResult({
                  ...existing,
                  status: event.pass ? 'pass' : 'fail',
                  score: event.score,
                  reason: event.reason,
                  sql: event.sql,
                  refRowCount: event.refRowCount ?? null,
                  agentRowCount: event.agentRowCount ?? null,
                })
              }
            }

            if (event.type === 'done') {
              setBenchmarkScore(event.overallScore)
              setActiveBenchmarkId(null)
              setBenchmarkRunning(false)
            }

            if (event.type === 'error') {
              setActiveBenchmarkId(null)
              setBenchmarkRunning(false)
            }
          } catch {
            // ignore parse errors
          }
        }
      }
    } catch {
      setBenchmarkRunning(false)
      setActiveBenchmarkId(null)
    }
  }, [benchmarkRunning, benchmarkResults, setBenchmarkRunning, updateBenchmarkResult, setBenchmarkScore, setActiveBenchmarkId])

  const passedCount = benchmarkResults.filter(r => r.status === 'pass').length
  const completedCount = benchmarkResults.filter(r => r.status === 'pass' || r.status === 'fail').length
  const totalScore = benchmarkResults.reduce((s, r) => s + (r.score ?? 0), 0)
  const progressPct = completedCount > 0 ? Math.round((completedCount / benchmarkResults.length) * 100) : 0
  const scorePct = completedCount > 0 ? Math.round((totalScore / benchmarkResults.length) * 100) : 0

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-4 py-3 border-b border-white/[0.06] shrink-0">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <Target size={14} className="text-violet-400" />
            <span className="text-xs font-semibold text-white">Benchmark</span>
            {completedCount > 0 && (
              <span className="text-xs text-gray-500 font-mono">
                {passedCount}/{benchmarkResults.length} passed
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {completedCount > 0 && (
              <button
                onClick={() => resetBenchmark()}
                disabled={benchmarkRunning}
                className="flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] text-gray-500 hover:text-gray-300 hover:bg-white/5 transition-all disabled:opacity-40"
              >
                <RotateCcw size={10} />
                Reset
              </button>
            )}
            <button
              onClick={() => runBenchmark()}
              disabled={benchmarkRunning || !dbSeeded}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-500 disabled:opacity-40 disabled:cursor-not-allowed transition-all text-white text-xs font-semibold"
            >
              {benchmarkRunning ? <Loader2 size={11} className="animate-spin" /> : <Play size={11} />}
              Run All
            </button>
          </div>
        </div>

        {/* Score bar */}
        {completedCount > 0 && (
          <div className="flex flex-col gap-1">
            <div className="flex items-center justify-between text-[10px]">
              <span className="text-gray-500">Score: {totalScore.toFixed(1)}/{benchmarkResults.length}</span>
              <span className="text-violet-400 font-mono">{scorePct}%</span>
            </div>
            <div className="h-1.5 bg-white/5 rounded-full overflow-hidden">
              <motion.div
                className="h-full rounded-full bg-gradient-to-r from-violet-600 to-violet-400"
                initial={{ width: 0 }}
                animate={{ width: `${scorePct}%` }}
                transition={{ duration: 0.5, ease: 'easeOut' }}
              />
            </div>
          </div>
        )}

        {/* Progress while running */}
        {benchmarkRunning && (
          <div className="mt-1.5">
            <div className="h-1 bg-white/5 rounded-full overflow-hidden">
              <motion.div
                className="h-full rounded-full bg-violet-500/60"
                initial={{ width: 0 }}
                animate={{ width: `${progressPct}%` }}
                transition={{ duration: 0.3 }}
              />
            </div>
          </div>
        )}
      </div>

      {/* Query list */}
      <div className="flex-1 overflow-y-auto">
        <div className="p-2 flex flex-col gap-1">
          {benchmarkResults.map((result) => (
            <QueryRow
              key={result.id}
              result={result}
              isActive={activeBenchmarkId === result.id}
              isExpanded={expandedIds.has(result.id)}
              onToggleExpand={() => toggleExpand(result.id)}
              onRunSingle={() => runBenchmark([result.id])}
              benchmarkRunning={benchmarkRunning}
              dbSeeded={dbSeeded}
            />
          ))}
        </div>
      </div>

      {/* Footer */}
      {!dbSeeded && (
        <div className="px-4 py-2 border-t border-white/[0.06] text-[10px] text-gray-600 text-center">
          Waiting for database initialization...
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Per-query row
// ---------------------------------------------------------------------------
interface QueryRowProps {
  result: BenchmarkQueryResult
  isActive: boolean
  isExpanded: boolean
  onToggleExpand: () => void
  onRunSingle: () => void
  benchmarkRunning: boolean
  dbSeeded: boolean
}

function QueryRow({ result, isActive, isExpanded, onToggleExpand, onRunSingle, benchmarkRunning, dbSeeded }: QueryRowProps) {
  const statusIcon = (() => {
    switch (result.status) {
      case 'pending':
        return <span className="w-2 h-2 rounded-full bg-gray-600 shrink-0" />
      case 'running':
        return <Loader2 size={12} className="text-violet-400 animate-spin shrink-0" />
      case 'pass':
        return <CheckCircle2 size={12} className="text-green-400 shrink-0" />
      case 'fail':
        return <XCircle size={12} className="text-red-400 shrink-0" />
    }
  })()

  const difficultyColor = result.difficulty === 'expert' ? 'text-orange-400 bg-orange-500/15 border-orange-500/30' : 'text-blue-400 bg-blue-500/15 border-blue-500/30'

  return (
    <div className={`rounded-xl border transition-all duration-150 ${isActive ? 'border-violet-500/40 bg-violet-500/5' : 'border-white/5 bg-white/[0.02] hover:bg-white/[0.04]'}`}>
      <div className="flex items-start gap-2 px-3 py-2.5 cursor-pointer" onClick={onToggleExpand}>
        <div className="mt-0.5">{statusIcon}</div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <span className="text-[10px] font-mono text-gray-600">{result.id}</span>
            <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded-full border ${difficultyColor}`}>
              {result.difficulty}
            </span>
            {result.score !== null && (
              <span className={`text-[10px] font-mono ${result.status === 'pass' ? 'text-green-400' : 'text-red-400'}`}>
                {result.score.toFixed(1)}
              </span>
            )}
          </div>
          <div className="text-xs text-gray-300 leading-relaxed line-clamp-1">{result.question}</div>
          {result.reason && result.status !== 'pending' && (
            <div className={`text-[10px] mt-1 ${result.status === 'pass' ? 'text-green-500/70' : 'text-red-400/70'}`}>
              {result.reason.length > 120 ? result.reason.slice(0, 120) + '...' : result.reason}
            </div>
          )}
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {result.status === 'pending' && dbSeeded && !benchmarkRunning && (
            <button
              onClick={(e) => { e.stopPropagation(); onRunSingle() }}
              className="p-1 rounded-lg hover:bg-white/10 transition-colors"
              title="Run this query"
            >
              <Play size={10} className="text-gray-500 hover:text-violet-400" />
            </button>
          )}
          <ChevronDown
            size={11}
            className={`text-gray-600 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
          />
        </div>
      </div>

      {/* Expanded detail */}
      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="overflow-hidden"
          >
            <div className="px-3 pb-3 flex flex-col gap-2 border-t border-white/5">
              <div className="text-xs text-gray-400 leading-relaxed pt-2">{result.question}</div>
              {result.sql && (
                <div>
                  <div className="text-[10px] text-gray-600 mb-1 font-semibold">Generated SQL</div>
                  <pre className="text-[10px] font-mono text-violet-200/70 bg-black/40 rounded-lg p-2.5 border border-white/5 whitespace-pre-wrap leading-relaxed max-h-40 overflow-y-auto">
                    {result.sql}
                  </pre>
                </div>
              )}
              {(result.reason || result.refRowCount !== null) && (
                <div className="flex flex-col gap-1.5">
                  {result.refRowCount !== null && (
                    <div className="flex items-center gap-3 text-[10px] font-mono">
                      <span className="text-gray-600">reference:</span>
                      <span className="text-blue-400">{result.refRowCount} rows</span>
                      <span className="text-gray-600">agent:</span>
                      <span className={result.agentRowCount === result.refRowCount ? 'text-green-400' : result.agentRowCount === 0 ? 'text-red-400' : 'text-yellow-400'}>
                        {result.agentRowCount ?? 0} rows
                      </span>
                    </div>
                  )}
                  {result.reason && (
                    <div className={`text-[10px] ${result.status === 'pass' ? 'text-green-400/80' : 'text-red-400/80'} leading-relaxed`}>
                      {result.reason}
                    </div>
                  )}
                </div>
              )}
              {result.status !== 'pending' && result.status !== 'running' && !benchmarkRunning && dbSeeded && (
                <button
                  onClick={(e) => { e.stopPropagation(); onRunSingle() }}
                  className="flex items-center gap-1 text-[10px] text-violet-400 hover:text-violet-300 transition-colors self-start mt-1"
                >
                  <RotateCcw size={9} />
                  Re-run
                </button>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
