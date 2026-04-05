'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { Send, CheckCircle2, XCircle, ChevronDown, ChevronUp, Loader2, RefreshCw, MessageSquare, GitCompare, Zap, ArrowRight, Plus, Minus } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import { useDemoStore } from '@/store/demo-store'
import type { ChatMessage, ChatOptimization, GepaRun } from '@/store/demo-store'
import { computeDiff } from '@/lib/diff'
import { classifyInput } from '@/lib/input-classifier'

const MAX_DISPLAY_ROWS = 100

function ResultTable({ rows, rowCount }: { rows: Record<string, unknown>[]; rowCount: number }) {
  if (rows.length === 0) {
    return (
      <div className="text-xs text-gray-500 italic px-3 py-2">No rows returned.</div>
    )
  }

  const displayRows = rows.slice(0, MAX_DISPLAY_ROWS)
  const columns = Object.keys(rows[0])

  return (
    <div className="overflow-auto max-h-64 rounded-xl border border-white/[0.06]">
      {rowCount > MAX_DISPLAY_ROWS && (
        <div className="px-3 py-1.5 text-[10px] text-amber-400/70 bg-amber-500/5 border-b border-amber-500/10">
          Showing first {MAX_DISPLAY_ROWS} of {rowCount} rows
        </div>
      )}
      <table className="w-full text-xs font-mono border-collapse">
        <thead>
          <tr className="border-b border-white/[0.06] bg-white/[0.02] sticky top-0">
            {columns.map(col => (
              <th key={col} className="px-3 py-2 text-left text-[10px] font-semibold text-gray-500 uppercase tracking-wider whitespace-nowrap">
                {col}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {displayRows.map((row, i) => (
            <tr key={i} className="border-b border-white/[0.03] hover:bg-white/[0.02] transition-colors">
              {columns.map(col => (
                <td key={col} className="px-3 py-1.5 text-gray-300 whitespace-nowrap max-w-xs overflow-hidden text-ellipsis">
                  {row[col] === null ? <span className="text-gray-600 italic">null</span> : String(row[col])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function ReasoningBlock({ reasoning, streaming, defaultOpen }: { reasoning: string; streaming: boolean; defaultOpen: boolean }) {
  const [expanded, setExpanded] = useState(defaultOpen)

  useEffect(() => {
    if (streaming) setExpanded(true)
    else setExpanded(false)
  }, [streaming])

  return (
    <div className="border border-white/[0.06] rounded-xl overflow-hidden bg-amber-950/10">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-3 py-2 bg-white/[0.02] hover:bg-white/[0.04] transition-colors"
      >
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-semibold text-amber-400/70 uppercase tracking-wider">Reasoning</span>
          {streaming && <Loader2 size={10} className="animate-spin text-amber-400/60" />}
          {!streaming && <span className="text-[9px] text-gray-600">{reasoning.split('\n').filter(l => l.trim()).length} steps</span>}
        </div>
        {expanded ? <ChevronUp size={11} className="text-gray-600" /> : <ChevronDown size={11} className="text-gray-600" />}
      </button>
      {expanded && (
        <div className="px-3 py-2.5 text-xs text-gray-400 leading-relaxed border-t border-white/[0.04] prose prose-invert prose-xs max-w-none prose-p:my-1 prose-ul:my-1 prose-li:my-0.5 prose-headings:my-1 prose-strong:text-gray-200 prose-code:text-violet-300 prose-code:bg-white/5 prose-code:px-1 prose-code:rounded">
          <ReactMarkdown>{reasoning}</ReactMarkdown>
        </div>
      )}
    </div>
  )
}

// ─── Inline Optimization Card ──────────────────────────────────

function OptimizationCard({ opt, onRetry }: { opt: ChatOptimization; onRetry?: () => void }) {
  const [expanded, setExpanded] = useState(false)
  const { setDiffModalOpen } = useDemoStore()

  if (opt.status === 'running') {
    return (
      <div className="border border-violet-500/20 bg-violet-950/20 rounded-xl px-4 py-3 flex items-center gap-3">
        <Loader2 size={14} className="animate-spin text-violet-400 shrink-0" />
        <div>
          <div className="text-[10px] font-semibold text-violet-300 uppercase tracking-wider">GEPA Optimizing</div>
          <div className="text-xs text-gray-400 mt-0.5">{opt.message || 'Analyzing failure patterns...'}</div>
        </div>
      </div>
    )
  }

  // Done state — show the result
  const diff = opt.previousPrompt && opt.newPrompt
    ? computeDiff(opt.previousPrompt, opt.newPrompt)
    : null

  return (
    <div className="border border-violet-500/25 bg-gradient-to-r from-violet-950/30 to-violet-950/10 rounded-xl overflow-hidden">
      {/* Header — always visible */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full px-4 py-3 flex items-center justify-between hover:bg-white/[0.02] transition-colors"
      >
        <div className="flex items-center gap-3">
          <div className="w-7 h-7 rounded-lg bg-violet-600/20 flex items-center justify-center shrink-0">
            <Zap size={13} className="text-violet-400" />
          </div>
          <div className="text-left">
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-violet-300">Prompt Evolved</span>
              <span className="text-[10px] bg-violet-500/20 text-violet-300 border border-violet-500/30 rounded-full px-2 py-0.5">
                Gen {opt.generation}
              </span>
              {opt.score !== undefined && opt.score > 0 && (
                <span className="text-[10px] text-gray-500 tabular-nums">
                  Score: {Math.round(opt.score * 100)}%
                </span>
              )}
            </div>
            {opt.diffSummary && (
              <p className="text-[11px] text-gray-400 mt-0.5 line-clamp-1">{opt.diffSummary}</p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {diff && (
            <div className="hidden sm:flex items-center gap-2 text-[10px]">
              <span className="text-green-400/70">+{diff.stats.added}</span>
              <span className="text-red-400/70">-{diff.stats.removed}</span>
            </div>
          )}
          {expanded ? <ChevronUp size={12} className="text-gray-600" /> : <ChevronDown size={12} className="text-gray-600" />}
        </div>
      </button>

      {/* Expanded: inline diff preview + open full modal */}
      {expanded && (
        <div className="border-t border-violet-500/15 px-4 py-3 flex flex-col gap-3">
          {/* Reflection */}
          {opt.reflection && (
            <div>
              <div className="text-[10px] font-semibold text-amber-400/60 uppercase tracking-wider mb-1.5">Why it changed</div>
              <div className="text-xs text-gray-400 leading-relaxed prose prose-invert prose-xs max-w-none prose-strong:text-gray-200 prose-ul:my-1 prose-li:my-0.5">
                <ReactMarkdown>{opt.reflection}</ReactMarkdown>
              </div>
            </div>
          )}

          {/* Mini diff preview — show first ~8 changed lines */}
          {diff && diff.stats.added + diff.stats.removed > 0 && (
            <div>
              <div className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-1.5">Changes</div>
              <div className="rounded-lg border border-white/[0.06] overflow-hidden bg-[#0a0a12] font-mono text-[11px]">
                {diff.lines
                  .filter(l => l.type !== 'unchanged')
                  .slice(0, 8)
                  .map((line, i) => (
                    <div
                      key={i}
                      className={`px-3 py-0.5 flex items-start gap-2 ${
                        line.type === 'added'
                          ? 'bg-green-500/8 text-green-300'
                          : 'bg-red-500/8 text-red-300'
                      }`}
                    >
                      <span className="shrink-0 w-3 text-center">
                        {line.type === 'added' ? '+' : '-'}
                      </span>
                      <span className="whitespace-pre-wrap break-all">{line.content || ' '}</span>
                    </div>
                  ))}
                {diff.lines.filter(l => l.type !== 'unchanged').length > 8 && (
                  <div className="px-3 py-1 text-[10px] text-gray-600 bg-white/[0.02]">
                    ... {diff.lines.filter(l => l.type !== 'unchanged').length - 8} more changes
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Action buttons */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => setDiffModalOpen(true)}
              className="flex-1 flex items-center justify-center gap-2 px-3 py-2 text-xs font-medium bg-violet-600/15 text-violet-300 border border-violet-500/25 rounded-lg hover:bg-violet-600/25 transition-all"
            >
              <GitCompare size={12} />
              View Diff
            </button>
            {onRetry && (
              <button
                onClick={onRetry}
                className="flex-1 flex items-center justify-center gap-2 px-3 py-2 text-xs font-medium bg-green-600/15 text-green-300 border border-green-500/25 rounded-lg hover:bg-green-600/25 transition-all"
              >
                <RefreshCw size={12} />
                Retry with Gen {opt.generation}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Message Card ───────────────────────────────────────────────

function MessageCard({ msg, onFeedback, onRetry }: {
  msg: ChatMessage
  onFeedback: (id: string, correct: boolean) => Promise<void>
  onRetry: (question: string) => void
}) {
  const [sqlExpanded, setSqlExpanded] = useState(false)

  return (
    <div className="flex flex-col gap-2.5">
      {/* Question */}
      <div className="flex items-start gap-2">
        <MessageSquare size={12} className="text-violet-400 mt-0.5 shrink-0" />
        <span className="text-sm text-white flex-1">{msg.question}</span>
        <span className="text-[9px] text-gray-600 bg-white/5 rounded px-1.5 py-0.5 shrink-0 tabular-nums">
          Gen {msg.promptGeneration}
        </span>
      </div>

      {/* Streaming indicator */}
      {msg.status === 'streaming' && !msg.reasoning && !msg.sql && (
        <div className="flex items-center gap-2 text-xs text-gray-500">
          <Loader2 size={11} className="animate-spin text-violet-400" />
          Thinking...
        </div>
      )}

      {/* Reasoning block */}
      {msg.reasoning && (() => {
        const isStreaming = msg.status === 'streaming' && !msg.sql
        const defaultOpen = isStreaming
        return (
          <ReasoningBlock reasoning={msg.reasoning} streaming={isStreaming} defaultOpen={defaultOpen} />
        )
      })()}

      {/* SQL block */}
      {msg.sql && (
        <div className="border border-white/[0.06] rounded-xl overflow-hidden">
          <button
            onClick={() => setSqlExpanded(!sqlExpanded)}
            className="w-full flex items-center justify-between px-3 py-2 bg-white/[0.02] hover:bg-white/[0.04] transition-colors"
          >
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider">SQL</span>
              {msg.status === 'streaming' && (
                <Loader2 size={10} className="animate-spin text-violet-400" />
              )}
            </div>
            {sqlExpanded ? <ChevronUp size={11} className="text-gray-600" /> : <ChevronDown size={11} className="text-gray-600" />}
          </button>
          {sqlExpanded && (
            <pre className="px-3 py-2.5 text-xs font-mono text-violet-200/80 bg-violet-950/20 whitespace-pre-wrap overflow-x-auto leading-relaxed border-t border-white/[0.04]">
              {msg.sql}
            </pre>
          )}
        </div>
      )}

      {/* Executing indicator */}
      {msg.status === 'streaming' && msg.sql && msg.rows.length === 0 && !msg.errorMsg && (
        <div className="flex items-center gap-2 text-xs text-gray-500">
          <Loader2 size={11} className="animate-spin text-violet-400" />
          Executing...
        </div>
      )}

      {/* Result — only for actual queries (attempts > 0), not suggestions */}
      {msg.status === 'done' && msg.attempts > 0 && (
        <div className="flex flex-col gap-1.5">
          <div className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider px-0.5">
            Result: {msg.rowCount} row{msg.rowCount !== 1 ? 's' : ''}
            {msg.attempts > 1 && (
              <span className="ml-2 text-amber-400/60">{msg.attempts} attempts</span>
            )}
          </div>
          <ResultTable rows={msg.rows} rowCount={msg.rowCount} />
        </div>
      )}

      {/* Error */}
      {msg.status === 'error' && (
        <div className="flex items-start gap-2 bg-red-500/10 border border-red-500/20 rounded-xl px-3 py-2.5 text-xs text-red-300">
          <XCircle size={12} className="shrink-0 mt-0.5" />
          <span>{msg.errorMsg ?? 'Query failed after all attempts'}</span>
        </div>
      )}

      {/* Feedback buttons — only for actual queries */}
      {msg.status === 'done' && msg.attempts > 0 && (
        <div className="flex items-center gap-2">
          {msg.feedback ? (
            <div className={`text-xs flex items-center gap-1.5 ${msg.feedback === 'correct' ? 'text-green-400' : 'text-red-400'}`}>
              {msg.feedback === 'correct' ? <CheckCircle2 size={12} /> : <XCircle size={12} />}
              Marked as {msg.feedback}
            </div>
          ) : (
            <>
              <button
                onClick={() => onFeedback(msg.id, true)}
                disabled={msg.feedbackSending}
                className="flex items-center gap-1.5 px-2.5 py-1 text-xs bg-green-500/10 text-green-400 border border-green-500/20 rounded-lg hover:bg-green-500/20 transition-colors disabled:opacity-50"
              >
                {msg.feedbackSending ? <Loader2 size={10} className="animate-spin" /> : <CheckCircle2 size={10} />}
                Correct
              </button>
              <button
                onClick={() => onFeedback(msg.id, false)}
                disabled={msg.feedbackSending}
                className="flex items-center gap-1.5 px-2.5 py-1 text-xs bg-red-500/10 text-red-400 border border-red-500/20 rounded-lg hover:bg-red-500/20 transition-colors disabled:opacity-50"
              >
                {msg.feedbackSending ? <Loader2 size={10} className="animate-spin" /> : <XCircle size={10} />}
                Wrong
              </button>
            </>
          )}
        </div>
      )}

      {/* Inline optimization card — appears below feedback when GEPA fires */}
      {msg.optimization && (
        <OptimizationCard
          opt={msg.optimization}
          onRetry={msg.optimization.status === 'done' ? () => onRetry(msg.question) : undefined}
        />
      )}
    </div>
  )
}

// ─── Chat Panel ─────────────────────────────────────────────────

export function ChatPanel() {
  const {
    chatMessages,
    addChatMessage,
    updateChatMessage,
    activeConnection,
    setConnectModalOpen,
    addGepaRun,
    setOptimizationDone,
    chatInput: input,
    setChatInput: setInput,
  } = useDemoStore()
  const [isSubmitting, setIsSubmitting] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Fire-and-forget session persistence
  const saveToSession = useCallback((msg: ChatMessage) => {
    const conn = useDemoStore.getState().activeConnection
    if (!conn?.name) return
    const rows = msg.rows ?? []
    fetch('/api/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'message',
        dbName: conn.name,
        dbType: conn.type,
        currentPrompt: useDemoStore.getState().currentPrompt,
        message: {
          id: msg.id,
          question: msg.question,
          sql: msg.sql,
          status: msg.status,
          feedback: msg.feedback,
          rowCount: msg.rowCount,
          columns: rows.length > 0 ? Object.keys(rows[0]) : [],
          preview: rows.slice(0, 3),
          attempts: msg.attempts,
          promptGeneration: msg.promptGeneration,
          timestamp: Date.now(),
        },
      }),
    }).catch(() => {})
  }, [])

  const saveFeedback = useCallback((messageId: string, feedback: 'correct' | 'wrong') => {
    const conn = useDemoStore.getState().activeConnection
    if (!conn?.name) return
    fetch('/api/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'feedback', dbName: conn.name, messageId, feedback }),
    }).catch(() => {})
  }, [])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [chatMessages])

  // Handle suggestion — trigger GEPA with the suggestion as a correction
  const handleSuggestion = useCallback(async (suggestion: string) => {
    const id = Date.now().toString()
    const currentGen = useDemoStore.getState().optimizations.length
    const msg: ChatMessage = {
      id,
      question: suggestion,
      reasoning: '',
      sql: '',
      rows: [],
      rowCount: 0,
      attempts: 0,
      status: 'done',
      feedback: null,
      promptGeneration: currentGen,
      optimization: { status: 'running', message: 'Applying your suggestion...' },
    }
    addChatMessage(msg)

    try {
      const chatHistory = useDemoStore.getState().chatMessages
        .filter(m => m.status === 'done' || m.status === 'error')
        .map(m => ({ question: m.question, sql: m.sql || undefined, rowCount: m.rowCount, feedback: m.feedback }))

      const res = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          correct: false,
          question: suggestion,
          sql: '',
          rowCount: 0,
          chatHistory,
        }),
      })

      const contentType = res.headers.get('content-type') ?? ''
      if (contentType.includes('text/event-stream') && res.body) {
        const reader = res.body.getReader()
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
              const event = JSON.parse(line.slice(6)) as Record<string, unknown>
              if (event.type === 'gepa_status') {
                updateChatMessage(id, { optimization: { status: 'running', message: event.message as string } })
              }
              if (event.type === 'done' && event.optimized) {
                const gepaRun = event.gepaRun as { generation: number; score: number; reflection: string; newPrompt: string; previousPrompt?: string; diffSummary?: string }
                addGepaRun({ generation: gepaRun.generation, score: gepaRun.score, label: `Gen ${gepaRun.generation}`, timestamp: Date.now(), triggeredBy: 'suggestion' })
                setOptimizationDone(gepaRun.reflection, gepaRun.newPrompt, { previousPrompt: gepaRun.previousPrompt, score: gepaRun.score, diffSummary: gepaRun.diffSummary })
                updateChatMessage(id, {
                  reasoning: `Thanks for the suggestion! I've incorporated it into the prompt.`,
                  optimization: { status: 'done', generation: gepaRun.generation, score: gepaRun.score, reflection: gepaRun.reflection, diffSummary: gepaRun.diffSummary, previousPrompt: gepaRun.previousPrompt, newPrompt: gepaRun.newPrompt },
                })
              }
              if (event.type === 'done' && !event.optimized) {
                updateChatMessage(id, { reasoning: 'Noted — your suggestion has been recorded for the next optimization cycle.', optimization: undefined })
              }
            } catch {}
          }
        }
      } else {
        // JSON response — check if optimization happened
        try {
          const data = await res.json()
          if (data.optimized && data.gepaRun) {
            const gepaRun = data.gepaRun
            addGepaRun({ generation: gepaRun.generation, score: gepaRun.score, label: `Gen ${gepaRun.generation}`, timestamp: Date.now(), triggeredBy: 'suggestion' })
            setOptimizationDone(gepaRun.reflection, gepaRun.newPrompt, { previousPrompt: gepaRun.previousPrompt, score: gepaRun.score, diffSummary: gepaRun.diffSummary })
            updateChatMessage(id, {
              reasoning: `Thanks for the suggestion! I've incorporated it into the prompt.`,
              optimization: { status: 'done', generation: gepaRun.generation, score: gepaRun.score, reflection: gepaRun.reflection, diffSummary: gepaRun.diffSummary, previousPrompt: gepaRun.previousPrompt, newPrompt: gepaRun.newPrompt },
            })
          } else {
            updateChatMessage(id, { reasoning: 'Noted — your suggestion has been recorded and will be used in the next optimization cycle.', optimization: undefined })
          }
        } catch {
          updateChatMessage(id, { reasoning: 'Noted — your suggestion has been recorded.', optimization: undefined })
        }
      }
    } catch {
      updateChatMessage(id, { reasoning: 'Noted — your suggestion has been recorded for the next optimization cycle.', optimization: undefined })
    }
  }, [addChatMessage, updateChatMessage, addGepaRun, setOptimizationDone])

  const handleSubmit = useCallback(async () => {
    const question = input.trim()
    if (!question || isSubmitting) return

    // Classify: is this a query or a suggestion?
    const { type: inputType, confidence } = classifyInput(question)
    if (inputType === 'suggestion' && confidence >= 0.5) {
      setInput('')
      handleSuggestion(question)
      return
    }

    setInput('')
    setIsSubmitting(true)

    const id = Date.now().toString()
    const currentGen = useDemoStore.getState().optimizations.length
    const msg: ChatMessage = {
      id,
      question,
      reasoning: '',
      sql: '',
      rows: [],
      rowCount: 0,
      attempts: 1,
      status: 'streaming',
      feedback: null,
      promptGeneration: currentGen,
    }
    addChatMessage(msg)

    try {
      const MAX_CONTEXT_ROWS = 50
      const history = useDemoStore.getState().chatMessages
        .filter(m => m.status === 'done' || m.status === 'error')
        .map(m => ({
          question: m.question,
          sql: m.sql || undefined,
          rowCount: m.rowCount,
          rows: m.rows.slice(0, MAX_CONTEXT_ROWS),
          rowsCapped: m.rows.length > MAX_CONTEXT_ROWS,
          success: m.status === 'done',
          feedback: m.feedback,
        }))

      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question,
          businessContext: useDemoStore.getState().businessContext || undefined,
          history,
        }),
      })

      if (!res.body) throw new Error('No response body')

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let currentAttempt = 1

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })

        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          try {
            const event = JSON.parse(line.slice(6)) as Record<string, unknown>

            if (event.type === 'attempt_start') {
              currentAttempt = event.attempt as number
              updateChatMessage(id, { attempts: currentAttempt })
            } else if (event.type === 'reasoning_chunk') {
              const current = chatMessages.find(m => m.id === id)
              updateChatMessage(id, {
                reasoning: (current?.reasoning ?? '') + (event.chunk as string),
              })
            } else if (event.type === 'reasoning_complete') {
              updateChatMessage(id, { reasoning: event.reasoning as string })
            } else if (event.type === 'sql_chunk') {
              updateChatMessage(id, {
                sql: (chatMessages.find(m => m.id === id)?.sql ?? '') + (event.chunk as string),
              })
            } else if (event.type === 'sql_complete') {
              updateChatMessage(id, { sql: event.sql as string })
            } else if (event.type === 'success') {
              const update = {
                status: 'done' as const,
                sql: event.sql as string,
                rows: event.rows as Record<string, unknown>[],
                rowCount: event.rowCount as number,
                attempts: event.attempt as number,
              }
              updateChatMessage(id, update)
              // Persist to session
              const saved = useDemoStore.getState().chatMessages.find(m => m.id === id)
              if (saved) saveToSession({ ...saved, ...update })
            } else if (event.type === 'failed') {
              const lastErr = event.lastError as string | undefined
              const update = {
                status: 'error' as const,
                errorMsg: `Failed after ${event.attempts} attempts${lastErr ? `: ${lastErr}` : ''}`,
              }
              updateChatMessage(id, update)
              const saved = useDemoStore.getState().chatMessages.find(m => m.id === id)
              if (saved) saveToSession({ ...saved, ...update })
            } else if (event.type === 'error' && event.attempt === 0) {
              updateChatMessage(id, {
                status: 'error',
                errorMsg: event.error as string,
              })
            }
          } catch {
            // ignore parse errors
          }
        }
      }
    } catch (err) {
      updateChatMessage(id, {
        status: 'error',
        errorMsg: (err as Error).message,
      })
    } finally {
      setIsSubmitting(false)
    }
  }, [input, isSubmitting, addChatMessage, updateChatMessage, chatMessages])

  const handleFeedback = useCallback(async (msgId: string, correct: boolean) => {
    const msg = chatMessages.find(m => m.id === msgId)
    if (!msg) return

    const fb = correct ? 'correct' : 'wrong' as const
    updateChatMessage(msgId, { feedbackSending: true, feedback: fb })
    saveFeedback(msgId, fb)

    try {
      // Build chat history for GEPA context — includes user corrections
      const chatHistory = useDemoStore.getState().chatMessages
        .filter(m => m.status === 'done' || m.status === 'error')
        .map(m => ({
          question: m.question,
          sql: m.sql || undefined,
          rowCount: m.rowCount,
          feedback: m.feedback,
        }))

      const res = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          correct,
          question: msg.question,
          sql: msg.sql,
          rowCount: msg.rowCount,
          chatHistory,
        }),
      })

      const contentType = res.headers.get('content-type') ?? ''

      if (contentType.includes('text/event-stream') && res.body) {
        // SSE stream — GEPA is running, show inline progress
        updateChatMessage(msgId, {
          optimization: { status: 'running', message: 'Analyzing failure patterns...' },
        })

        const reader = res.body.getReader()
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
              const event = JSON.parse(line.slice(6)) as Record<string, unknown>

              if (event.type === 'gepa_status') {
                // Update inline progress
                updateChatMessage(msgId, {
                  optimization: { status: 'running', message: event.message as string },
                })
              }

              if (event.type === 'done' && event.optimized) {
                const gepaRun = event.gepaRun as {
                  generation: number; score: number; reflection: string
                  newPrompt: string; previousPrompt?: string; diffSummary?: string
                }
                const run: GepaRun = {
                  generation: gepaRun.generation,
                  score: gepaRun.score,
                  label: `Gen ${gepaRun.generation}`,
                  timestamp: Date.now(),
                  triggeredBy: 'feedback',
                }
                addGepaRun(run)
                setOptimizationDone(gepaRun.reflection, gepaRun.newPrompt, {
                  previousPrompt: gepaRun.previousPrompt,
                  score: gepaRun.score,
                  diffSummary: gepaRun.diffSummary,
                })

                // Show completed optimization inline on the message
                updateChatMessage(msgId, {
                  optimization: {
                    status: 'done',
                    generation: gepaRun.generation,
                    score: gepaRun.score,
                    reflection: gepaRun.reflection,
                    diffSummary: gepaRun.diffSummary,
                    previousPrompt: gepaRun.previousPrompt,
                    newPrompt: gepaRun.newPrompt,
                  },
                })
              }

              if (event.type === 'done' && !event.optimized) {
                // No optimization — clear the running state
                updateChatMessage(msgId, { optimization: undefined })
              }
            } catch {}
          }
        }
      } else {
        // Plain JSON response
        const data = await res.json()
        if (data.optimized && data.gepaRun) {
          const run: GepaRun = {
            generation: data.gepaRun.generation,
            score: data.gepaRun.score,
            label: `Gen ${data.gepaRun.generation}`,
            timestamp: Date.now(),
            triggeredBy: 'feedback',
          }
          addGepaRun(run)
          setOptimizationDone(data.gepaRun.reflection, data.gepaRun.newPrompt, {
            previousPrompt: data.gepaRun.previousPrompt,
            score: data.gepaRun.score,
            diffSummary: data.gepaRun.diffSummary,
          })

          updateChatMessage(msgId, {
            optimization: {
              status: 'done',
              generation: data.gepaRun.generation,
              score: data.gepaRun.score,
              reflection: data.gepaRun.reflection,
              diffSummary: data.gepaRun.diffSummary,
              previousPrompt: data.gepaRun.previousPrompt,
              newPrompt: data.gepaRun.newPrompt,
            },
          })
        }
      }

      updateChatMessage(msgId, { feedbackSending: false })
    } catch {
      updateChatMessage(msgId, { feedbackSending: false, optimization: undefined })
    }
  }, [chatMessages, updateChatMessage, addGepaRun, setOptimizationDone])

  // Re-run a question with the current (evolved) prompt
  const handleRetry = useCallback((question: string) => {
    setInput(question)
    // Auto-submit after a tick so the input is set
    setTimeout(() => {
      const store = useDemoStore.getState()
      if (store.chatInput.trim()) {
        // Trigger submit by simulating the flow
        setInput('')
        setIsSubmitting(true)

        const id = Date.now().toString()
        const currentGen = store.optimizations.length
        const msg: ChatMessage = {
          id,
          question,
          reasoning: '',
          sql: '',
          rows: [],
          rowCount: 0,
          attempts: 1,
          status: 'streaming',
          feedback: null,
          promptGeneration: currentGen,
        }
        addChatMessage(msg)

        const MAX_CONTEXT_ROWS = 50
        const history = store.chatMessages
          .filter(m => m.status === 'done' || m.status === 'error')
          .map(m => ({
            question: m.question,
            sql: m.sql || undefined,
            rowCount: m.rowCount,
            rows: m.rows.slice(0, MAX_CONTEXT_ROWS),
            rowsCapped: m.rows.length > MAX_CONTEXT_ROWS,
            success: m.status === 'done',
            feedback: m.feedback,
          }))

        fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            question,
            businessContext: store.businessContext || undefined,
            history,
          }),
        }).then(async (res) => {
          if (!res.body) throw new Error('No response body')
          const reader = res.body.getReader()
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
                const event = JSON.parse(line.slice(6)) as Record<string, unknown>
                if (event.type === 'reasoning_complete') {
                  updateChatMessage(id, { reasoning: event.reasoning as string })
                } else if (event.type === 'sql_complete') {
                  updateChatMessage(id, { sql: event.sql as string })
                } else if (event.type === 'success') {
                  updateChatMessage(id, {
                    status: 'done',
                    sql: event.sql as string,
                    rows: event.rows as Record<string, unknown>[],
                    rowCount: event.rowCount as number,
                    attempts: event.attempt as number,
                  })
                } else if (event.type === 'failed') {
                  updateChatMessage(id, { status: 'error', errorMsg: `Failed after ${event.attempts} attempts` })
                } else if (event.type === 'reasoning_chunk') {
                  const cur = useDemoStore.getState().chatMessages.find(m => m.id === id)
                  updateChatMessage(id, { reasoning: (cur?.reasoning ?? '') + (event.chunk as string) })
                } else if (event.type === 'sql_chunk') {
                  const cur = useDemoStore.getState().chatMessages.find(m => m.id === id)
                  updateChatMessage(id, { sql: (cur?.sql ?? '') + (event.chunk as string) })
                }
              } catch {}
            }
          }
        }).catch((err) => {
          updateChatMessage(id, { status: 'error', errorMsg: (err as Error).message })
        }).finally(() => {
          setIsSubmitting(false)
        })
      }
    }, 50)
  }, [addChatMessage, updateChatMessage, setInput, setIsSubmitting])

  if (!activeConnection) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 text-gray-600">
        <MessageSquare size={32} className="text-gray-700" />
        <div className="text-center">
          <p className="text-sm font-medium text-gray-500">No database connected</p>
          <p className="text-xs text-gray-600 mt-1">Connect a database to start chatting</p>
        </div>
        <button
          onClick={() => setConnectModalOpen(true)}
          className="px-4 py-2 text-xs font-semibold bg-violet-600/20 text-violet-300 border border-violet-500/30 rounded-xl hover:bg-violet-600/30 transition-colors"
        >
          Connect Database
        </button>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full relative">
      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4 flex flex-col gap-6">
        {chatMessages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-center">
            <MessageSquare size={28} className="text-gray-700" />
            <p className="text-sm text-gray-500">Ask anything about your database</p>
            <p className="text-xs text-gray-600">Connected to: <span className="text-violet-400">{activeConnection.name}</span></p>
          </div>
        )}
        {chatMessages.map(msg => (
          <div key={msg.id} className="flex flex-col gap-2">
            <MessageCard msg={msg} onFeedback={handleFeedback} onRetry={handleRetry} />
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="shrink-0 border-t theme-border px-4 py-3 theme-bg-secondary">
        <div className="flex items-center gap-2">
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSubmit() } }}
            placeholder="Ask anything about your database..."
            disabled={isSubmitting}
            className="flex-1 bg-white/[0.03] border border-white/[0.08] rounded-xl px-3 py-2 text-sm text-white placeholder-gray-600 font-mono focus:outline-none focus:border-violet-500/50 transition-colors disabled:opacity-50"
          />
          <button
            onClick={handleSubmit}
            disabled={!input.trim() || isSubmitting}
            className="p-2 bg-violet-600/30 text-violet-300 border border-violet-500/40 rounded-xl hover:bg-violet-600/40 transition-colors disabled:opacity-40 flex items-center justify-center"
          >
            {isSubmitting ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
          </button>
          {chatMessages.length > 0 && (
            <button
              onClick={() => useDemoStore.getState().clearChat()}
              title="Clear chat"
              className="p-2 text-gray-600 hover:text-gray-400 hover:bg-white/5 rounded-xl transition-colors"
            >
              <RefreshCw size={13} />
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
