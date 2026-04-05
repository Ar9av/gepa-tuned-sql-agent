'use client'

import { useState, useMemo } from 'react'
import { X, GitCompare, ChevronRight, Plus, Minus, Equal, Brain, Zap, ArrowRight } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import { motion, AnimatePresence } from 'framer-motion'
import { useDemoStore } from '@/store/demo-store'
import type { OptimizationEvent } from '@/store/demo-store'
import { computeDiff, groupIntoHunks } from '@/lib/diff'

const SEED_SYSTEM_PROMPT = `You are a SQL expert. Given a natural language question and a SQLite database schema, write a correct SQL query.

Rules:
- Output ONLY the SQL query, nothing else
- No markdown, no code fences, no explanation
- Use SQLite syntax`

function DiffView({ oldText, newText }: { oldText: string; newText: string }) {
  const diff = useMemo(() => computeDiff(oldText, newText), [oldText, newText])
  const hunks = useMemo(() => groupIntoHunks(diff, 3), [diff])

  return (
    <div className="flex flex-col gap-3">
      {/* Stats bar */}
      <div className="flex items-center gap-4 text-xs">
        <span className="flex items-center gap-1 text-green-400">
          <Plus size={11} />
          {diff.stats.added} added
        </span>
        <span className="flex items-center gap-1 text-red-400">
          <Minus size={11} />
          {diff.stats.removed} removed
        </span>
        <span className="flex items-center gap-1 text-gray-500">
          <Equal size={11} />
          {diff.stats.unchanged} unchanged
        </span>
      </div>

      {/* Diff hunks */}
      <div className="rounded-xl border border-white/[0.08] overflow-hidden bg-[#0a0a12]">
        {hunks.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-gray-500">No changes between these versions</div>
        ) : (
          hunks.map((hunk, hi) => (
            <div key={hi}>
              {hi > 0 && (
                <div className="px-4 py-1.5 bg-white/[0.02] text-[10px] text-gray-600 font-mono border-y border-white/[0.04]">
                  ···
                </div>
              )}
              {hunk.lines.map((line, li) => (
                <div
                  key={`${hi}-${li}`}
                  className={`flex font-mono text-xs leading-relaxed ${
                    line.type === 'added'
                      ? 'bg-green-500/8 border-l-2 border-green-500/40'
                      : line.type === 'removed'
                      ? 'bg-red-500/8 border-l-2 border-red-500/40'
                      : 'border-l-2 border-transparent'
                  }`}
                >
                  {/* Line numbers */}
                  <span className="w-10 shrink-0 text-right pr-2 py-0.5 text-[10px] text-gray-700 select-none">
                    {line.oldLineNo ?? ''}
                  </span>
                  <span className="w-10 shrink-0 text-right pr-2 py-0.5 text-[10px] text-gray-700 select-none">
                    {line.newLineNo ?? ''}
                  </span>

                  {/* Change indicator */}
                  <span className={`w-5 shrink-0 text-center py-0.5 select-none ${
                    line.type === 'added' ? 'text-green-400' : line.type === 'removed' ? 'text-red-400' : 'text-gray-700'
                  }`}>
                    {line.type === 'added' ? '+' : line.type === 'removed' ? '-' : ' '}
                  </span>

                  {/* Content */}
                  <span className={`flex-1 py-0.5 pr-4 whitespace-pre-wrap break-all ${
                    line.type === 'added' ? 'text-green-300' : line.type === 'removed' ? 'text-red-300' : 'text-gray-400'
                  }`}>
                    {line.content || ' '}
                  </span>
                </div>
              ))}
            </div>
          ))
        )}
      </div>
    </div>
  )
}

function GenerationCard({
  opt,
  index,
  isSelected,
  onClick,
}: {
  opt: OptimizationEvent
  index: number
  isSelected: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full text-left px-3 py-2.5 rounded-xl border transition-all ${
        isSelected
          ? 'bg-violet-600/20 border-violet-500/40 shadow-lg shadow-violet-500/5'
          : 'bg-white/[0.02] border-white/[0.06] hover:bg-white/[0.04] hover:border-white/[0.1]'
      }`}
    >
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-2">
          <span className={`text-xs font-bold ${isSelected ? 'text-violet-300' : 'text-white/70'}`}>
            Gen {opt.generation}
          </span>
          {opt.score > 0 && (
            <span className="text-[10px] text-gray-500 tabular-nums">
              {Math.round(opt.score * 100)}%
            </span>
          )}
        </div>
        <ChevronRight size={12} className={isSelected ? 'text-violet-400' : 'text-gray-700'} />
      </div>
      {opt.diffSummary && (
        <p className="text-[10px] text-gray-500 leading-relaxed line-clamp-2">{opt.diffSummary}</p>
      )}
      {opt.timestamp > 0 && (
        <p className="text-[9px] text-gray-700 mt-1">
          {new Date(opt.timestamp).toLocaleTimeString()}
        </p>
      )}
    </button>
  )
}

export function PromptDiffModal() {
  const { diffModalOpen, setDiffModalOpen, optimizations, currentPrompt } = useDemoStore()
  const [selectedGen, setSelectedGen] = useState<number>(0)

  if (!diffModalOpen) return null

  const hasOptimizations = optimizations.length > 0
  const selected = selectedGen < optimizations.length ? optimizations[selectedGen] : null

  // Build the old/new for the selected generation
  const oldText = selected?.previousPrompt || SEED_SYSTEM_PROMPT
  const newText = selected?.newPrompt || currentPrompt || SEED_SYSTEM_PROMPT

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={() => setDiffModalOpen(false)} />

      {/* Modal */}
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96 }}
        className="relative w-[95vw] max-w-5xl h-[85vh] bg-[#0c0c14] border border-white/[0.08] rounded-2xl shadow-2xl shadow-black/50 flex flex-col overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/[0.06] shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-violet-600/20 flex items-center justify-center">
              <GitCompare size={16} className="text-violet-400" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-white">Prompt Evolution</h2>
              <p className="text-[10px] text-gray-500">
                {optimizations.length} generation{optimizations.length !== 1 ? 's' : ''} — compare how the system prompt evolved
              </p>
            </div>
          </div>
          <button
            onClick={() => setDiffModalOpen(false)}
            className="p-2 rounded-lg hover:bg-white/5 text-gray-500 hover:text-white transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="flex flex-1 overflow-hidden">
          {/* Left: Generation timeline */}
          <div className="w-56 lg:w-64 shrink-0 border-r border-white/[0.06] overflow-y-auto p-3 flex flex-col gap-2">
            <div className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider px-1 mb-1">
              Timeline
            </div>

            {/* Seed (Gen 0) */}
            <button
              onClick={() => setSelectedGen(-1)}
              className={`w-full text-left px-3 py-2.5 rounded-xl border transition-all ${
                selectedGen === -1
                  ? 'bg-violet-600/20 border-violet-500/40'
                  : 'bg-white/[0.02] border-white/[0.06] hover:bg-white/[0.04]'
              }`}
            >
              <div className="flex items-center gap-2">
                <Brain size={12} className={selectedGen === -1 ? 'text-violet-400' : 'text-gray-600'} />
                <span className={`text-xs font-bold ${selectedGen === -1 ? 'text-violet-300' : 'text-white/70'}`}>
                  Seed Prompt
                </span>
              </div>
              <p className="text-[10px] text-gray-500 mt-1">Initial base prompt</p>
            </button>

            {/* Generations */}
            {optimizations.map((opt, i) => (
              <div key={opt.generation} className="relative">
                {/* Connector line */}
                <div className="absolute -top-2 left-5 w-px h-2 bg-white/10" />
                <GenerationCard
                  opt={opt}
                  index={i}
                  isSelected={selectedGen === i}
                  onClick={() => setSelectedGen(i)}
                />
              </div>
            ))}

            {!hasOptimizations && (
              <div className="px-3 py-6 text-center">
                <Zap size={20} className="text-gray-700 mx-auto mb-2" />
                <p className="text-xs text-gray-600">No optimizations yet</p>
                <p className="text-[10px] text-gray-700 mt-1">Mark queries as wrong to trigger GEPA</p>
              </div>
            )}
          </div>

          {/* Right: Diff view */}
          <div className="flex-1 overflow-y-auto p-5 min-w-0">
            {selectedGen === -1 ? (
              // Seed prompt — show full text, no diff
              <div className="flex flex-col gap-4">
                <div className="flex items-center gap-2">
                  <Brain size={14} className="text-violet-400" />
                  <span className="text-sm font-semibold text-white">Seed System Prompt</span>
                  <span className="text-xs bg-white/5 text-gray-500 rounded-full px-2 py-0.5">Gen 0</span>
                </div>
                <pre className="text-xs font-mono text-violet-200/70 bg-violet-950/20 rounded-xl p-4 border border-violet-500/15 whitespace-pre-wrap leading-relaxed">
                  {SEED_SYSTEM_PROMPT}
                </pre>
                {hasOptimizations && (
                  <button
                    onClick={() => setSelectedGen(0)}
                    className="flex items-center gap-2 text-xs text-violet-400 hover:text-violet-300 transition-colors self-start"
                  >
                    See what changed in Gen 1 <ArrowRight size={12} />
                  </button>
                )}
              </div>
            ) : selected ? (
              <div className="flex flex-col gap-5">
                {/* Generation header */}
                <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-white">Generation {selected.generation}</span>
                    {selected.score > 0 && (
                      <span className="text-xs bg-violet-500/20 text-violet-300 border border-violet-500/30 rounded-full px-2 py-0.5 tabular-nums">
                        Score: {Math.round(selected.score * 100)}%
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 text-[10px] text-gray-600">
                    <span className="bg-red-500/10 text-red-400 px-1.5 py-0.5 rounded">Gen {selected.generation - 1}</span>
                    <ArrowRight size={10} />
                    <span className="bg-green-500/10 text-green-400 px-1.5 py-0.5 rounded">Gen {selected.generation}</span>
                  </div>
                </div>

                {/* Reflection / reasoning */}
                <div className="bg-amber-950/15 border border-amber-500/15 rounded-xl p-4">
                  <div className="text-[10px] font-semibold text-amber-400/70 uppercase tracking-wider mb-2">
                    Why this changed
                  </div>
                  <div className="text-xs text-gray-400 leading-relaxed prose prose-invert prose-xs max-w-none prose-strong:text-gray-200 prose-ul:my-1 prose-li:my-0.5">
                    <ReactMarkdown>{selected.reflection}</ReactMarkdown>
                  </div>
                </div>

                {/* Diff summary (if available) */}
                {selected.diffSummary && (
                  <div className="bg-violet-950/15 border border-violet-500/15 rounded-xl p-4">
                    <div className="text-[10px] font-semibold text-violet-400/70 uppercase tracking-wider mb-2">
                      Change Summary
                    </div>
                    <div className="text-xs text-gray-400 leading-relaxed prose prose-invert prose-xs max-w-none prose-strong:text-gray-200 prose-ul:my-1 prose-li:my-0.5">
                      <ReactMarkdown>{selected.diffSummary}</ReactMarkdown>
                    </div>
                  </div>
                )}

                {/* Line-by-line diff */}
                <div>
                  <div className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-3">
                    Line-by-line diff
                  </div>
                  <DiffView oldText={oldText} newText={newText} />
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center h-full text-gray-600 gap-3">
                <GitCompare size={28} className="text-gray-700" />
                <p className="text-sm">Select a generation to see the diff</p>
              </div>
            )}
          </div>
        </div>
      </motion.div>
    </div>
  )
}
