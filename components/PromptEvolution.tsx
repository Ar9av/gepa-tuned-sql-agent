'use client'

import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Brain, ChevronDown, ChevronUp, Zap } from 'lucide-react'
import { useDemoStore } from '@/store/demo-store'

const SEED_SYSTEM_PROMPT = `You are a SQL expert. Given a natural language question and a SQLite database schema, write a correct SQL query.

Rules:
- Output ONLY the SQL query, nothing else
- No markdown, no code fences, no explanation
- Use SQLite syntax`

export function PromptEvolution() {
  const { currentPrompt, optimizations } = useDemoStore()
  const [expanded, setExpanded] = useState(false)

  const prompt = currentPrompt || SEED_SYSTEM_PROMPT
  const generation = optimizations.length

  return (
    <div className="flex flex-col gap-2">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center justify-between w-full group"
      >
        <div className="flex items-center gap-2">
          <Brain size={14} className="text-violet-400" />
          <span className="text-xs font-semibold text-white/70">System Prompt</span>
          {generation > 0 && (
            <span className="text-xs bg-violet-500/20 text-violet-300 border border-violet-500/30 rounded-full px-2 py-0.5">
              Gen {generation}
            </span>
          )}
          {generation === 0 && (
            <span className="text-xs bg-white/5 text-gray-500 rounded-full px-2 py-0.5">
              Seed
            </span>
          )}
        </div>
        {expanded ? <ChevronUp size={13} className="text-gray-500" /> : <ChevronDown size={13} className="text-gray-500" />}
      </button>

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <pre className="text-xs font-mono text-violet-200/70 bg-violet-950/30 rounded-xl p-3 border border-violet-500/20 whitespace-pre-wrap leading-relaxed">
              {prompt}
            </pre>

            {/* Optimization history */}
            {optimizations.length > 0 && (
              <div className="mt-3 flex flex-col gap-2">
                <div className="text-xs text-gray-500 font-medium flex items-center gap-1">
                  <Zap size={11} className="text-violet-400" />
                  Optimization History
                </div>
                {optimizations.map((opt) => (
                  <div key={opt.generation} className="border border-white/5 rounded-xl p-2.5">
                    <div className="text-xs font-semibold text-violet-400 mb-1">Generation {opt.generation}</div>
                    <div className="text-xs text-gray-400 leading-relaxed">{opt.reflection}</div>
                  </div>
                ))}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
