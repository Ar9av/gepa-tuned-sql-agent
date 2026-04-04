'use client'

import { useState, KeyboardEvent } from 'react'
import { Send, Sparkles } from 'lucide-react'
import { useDemoStore } from '@/store/demo-store'

// Suggested questions per schema type
const SUGGESTED: Record<string, string[]> = {
  ecommerce: [
    "Which customers placed 3+ orders last quarter but haven't ordered this month?",
    "Find the top 5 products by revenue, excluding cancelled orders",
    "Show customers whose average order value increased month over month for 3 consecutive months",
    "Which product categories have the highest return rate?",
    "Find customers who reviewed a product they never ordered",
  ],
  hospital: [
    "Which patients were readmitted within 30 days of discharge?",
    "Find doctors who have patients with 3+ different chronic diagnoses",
    "Show departments with the highest average visit duration this year",
    "Which patients have prescriptions from more than 2 different doctors simultaneously?",
    "Find uninsured patients with lab costs over $1000",
  ],
  banking: [
    "Find accounts that had 3+ transactions flagged as suspicious in the last 90 days",
    "Which customers have a loan but haven't made a payment in 60+ days?",
    "Show customers whose spending on entertainment exceeded salary income last month",
    "Find accounts with a running balance that went negative more than twice",
    "Which branch has the highest average loan default rate?",
  ],
}

export function QueryInput() {
  const [question, setQuestion] = useState('')
  const { schemaType, tableStats, isRunning,
    startQuery, startAttempt, appendSQLChunk, setAttemptStatus,
    setAttemptError, appendDiagnosisChunk, finishQuery,
    setOptimizationStart, setOptimizationDone,
  } = useDemoStore()

  const suggestions = schemaType ? SUGGESTED[schemaType] ?? [] : []
  const canAsk = !isRunning && tableStats.length > 0

  async function runQuery(q: string) {
    if (!q.trim() || !canAsk) return
    setQuestion('')
    startQuery(q)

    try {
      const res = await fetch('/api/execute-query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: q }),
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
          let event: Record<string, unknown>
          try { event = JSON.parse(line.slice(6)) } catch { continue }

          switch (event.type) {
            case 'attempt_start':
              startAttempt(event.attempt as number)
              break
            case 'sql_chunk':
              appendSQLChunk(event.chunk as string, event.attempt as number)
              break
            case 'sql_complete':
              setAttemptStatus(event.attempt as number, 'executing')
              break
            case 'executing':
              setAttemptStatus(event.attempt as number, 'executing')
              break
            case 'error':
              setAttemptError(event.attempt as number, event.error as string)
              break
            case 'diagnosis_chunk':
              appendDiagnosisChunk(event.chunk as string, event.attempt as number)
              break
            case 'success':
              setAttemptStatus(event.attempt as number, 'success')
              finishQuery(true, event.rows as Record<string, unknown>[], event.rowCount as number, event.sql as string)
              break
            case 'failed':
            case 'agent_error':
              finishQuery(false)
              break
            case 'optimization_start':
              setOptimizationStart()
              break
            case 'optimization_done':
              setOptimizationDone(event.reflection as string, event.newPrompt as string)
              break
          }
        }
      }
    } catch (err) {
      console.error('runQuery error:', err)
      finishQuery(false)
    }
  }

  function handleKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      runQuery(question)
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Suggestions */}
      {suggestions.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-1.5 text-xs text-gray-500 font-medium">
            <Sparkles size={11} />
            Try these challenging queries
          </div>
          <div className="flex flex-wrap gap-1.5">
            {suggestions.map((s, i) => (
              <button
                key={i}
                onClick={() => runQuery(s)}
                disabled={!canAsk}
                className="text-xs bg-white/5 hover:bg-white/10 border border-white/10 hover:border-violet-500/40 text-gray-400 hover:text-white rounded-lg px-2.5 py-1.5 transition-all text-left disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Input */}
      <div className="relative">
        <textarea
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={handleKey}
          disabled={!canAsk}
          placeholder={
            tableStats.length === 0
              ? 'Generate a schema first...'
              : 'Ask anything in plain English... (Enter to run)'
          }
          rows={2}
          className="w-full bg-white/5 border border-white/10 focus:border-violet-500/60 rounded-xl px-4 py-3 pr-12 text-sm text-white placeholder-gray-600 resize-none outline-none transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        />
        <button
          onClick={() => runQuery(question)}
          disabled={!canAsk || !question.trim()}
          className="absolute right-2.5 bottom-2.5 p-2 rounded-lg bg-violet-600 hover:bg-violet-500 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
        >
          <Send size={13} className="text-white" />
        </button>
      </div>
    </div>
  )
}
