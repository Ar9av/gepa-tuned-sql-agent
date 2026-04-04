'use client'

import { motion, AnimatePresence } from 'framer-motion'
import { CheckCircle2, XCircle, Loader2, Wrench, Zap } from 'lucide-react'
import { useDemoStore, type Attempt } from '@/store/demo-store'

function AttemptCard({ attempt, isLast }: { attempt: Attempt; isLast: boolean }) {
  const statusConfig = {
    generating: { color: 'border-blue-500/40 bg-blue-500/5', dot: 'bg-blue-400', label: 'Generating SQL...' },
    executing: { color: 'border-yellow-500/40 bg-yellow-500/5', dot: 'bg-yellow-400', label: 'Executing...' },
    error: { color: 'border-red-500/40 bg-red-500/5', dot: 'bg-red-400', label: 'Error' },
    diagnosing: { color: 'border-orange-500/40 bg-orange-500/5', dot: 'bg-orange-400', label: 'Diagnosing...' },
    success: { color: 'border-green-500/40 bg-green-500/5', dot: 'bg-green-400', label: 'Success' },
  }

  const config = statusConfig[attempt.status]

  return (
    <motion.div
      initial={{ opacity: 0, x: -12 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.3 }}
      className={`rounded-xl border p-3 ${config.color}`}
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <div className={`w-1.5 h-1.5 rounded-full ${config.dot} ${isLast && attempt.status !== 'success' && attempt.status !== 'error' ? 'animate-pulse' : ''}`} />
          <span className="text-xs font-semibold text-white/70">Attempt {attempt.number}</span>
        </div>
        <div className="flex items-center gap-1.5">
          {attempt.status === 'success' && <CheckCircle2 size={13} className="text-green-400" />}
          {attempt.status === 'error' && <XCircle size={13} className="text-red-400" />}
          {(attempt.status === 'generating' || attempt.status === 'executing' || attempt.status === 'diagnosing') && isLast && (
            <Loader2 size={13} className="text-white/40 animate-spin" />
          )}
          <span className="text-xs text-white/40">{config.label}</span>
        </div>
      </div>

      {/* SQL */}
      {attempt.sql && (
        <pre className="text-xs font-mono text-blue-200/80 bg-black/30 rounded-lg p-2.5 overflow-x-auto whitespace-pre-wrap break-all leading-relaxed mb-2">
          {attempt.sql}
          {attempt.status === 'generating' && isLast && <span className="animate-pulse text-blue-400">█</span>}
        </pre>
      )}

      {/* Error */}
      {attempt.error && (
        <div className="flex items-start gap-2 bg-red-500/10 rounded-lg p-2 mb-2">
          <XCircle size={11} className="text-red-400 mt-0.5 shrink-0" />
          <span className="text-xs font-mono text-red-300">{attempt.error}</span>
        </div>
      )}

      {/* Diagnosis */}
      {attempt.diagnosis && (
        <div className="flex items-start gap-2 bg-orange-500/10 rounded-lg p-2">
          <Wrench size={11} className="text-orange-400 mt-0.5 shrink-0" />
          <span className="text-xs text-orange-200/80 leading-relaxed">
            {attempt.diagnosis}
            {attempt.status === 'diagnosing' && isLast && <span className="animate-pulse text-orange-400"> █</span>}
          </span>
        </div>
      )}
    </motion.div>
  )
}

export function DebugLoop() {
  const { currentQuery, isRunning, currentOptimization } = useDemoStore()

  if (!currentQuery && !isRunning) {
    return (
      <div className="flex flex-col items-center justify-center h-48 text-center text-gray-600">
        <Zap size={28} className="mb-3 text-gray-700" />
        <p className="text-sm">Ask a question to see the debug loop in action</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Question */}
      {currentQuery && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="text-sm text-white/80 font-medium bg-white/5 rounded-xl px-3 py-2.5 border border-white/10"
        >
          {currentQuery.question}
        </motion.div>
      )}

      {/* Attempt stack */}
      <div className="flex flex-col gap-2">
        <AnimatePresence>
          {currentQuery?.attempts.map((attempt, i) => (
            <AttemptCard
              key={attempt.number}
              attempt={attempt}
              isLast={i === (currentQuery.attempts.length - 1)}
            />
          ))}
        </AnimatePresence>
      </div>

      {/* GEPA optimization banner */}
      <AnimatePresence>
        {currentOptimization && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="rounded-xl border border-violet-500/40 bg-violet-500/10 p-3"
          >
            <div className="flex items-center gap-2 mb-2">
              <Zap size={13} className="text-violet-400" />
              <span className="text-xs font-semibold text-violet-300">GEPA Optimization Triggered</span>
            </div>
            <p className="text-xs text-violet-200/70 leading-relaxed">{currentOptimization.reflection}</p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
