'use client'

import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine,
} from 'recharts'
import { useDemoStore } from '@/store/demo-store'
import { TrendingDown } from 'lucide-react'

const CustomTooltip = ({ active, payload, label }: { active?: boolean; payload?: { value: number; name: string; color: string }[]; label?: string }) => {
  if (active && payload?.length) {
    return (
      <div className="bg-gray-900 border border-white/10 rounded-lg px-3 py-2 text-xs">
        <p className="text-gray-400 mb-1">Query #{label}</p>
        {payload.map((p) => (
          <p key={p.name} style={{ color: p.color }}>
            {p.name}: <span className="font-semibold">{p.name.includes('%') ? `${p.value}%` : p.value}</span>
          </p>
        ))}
      </div>
    )
  }
  return null
}

export function PerformanceGraph() {
  const { chatMessages, optimizations } = useDemoStore()

  // Use chatMessages (completed ones) as the data source
  const completed = chatMessages.filter(m => m.status === 'done' || m.status === 'error')

  if (completed.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-40 text-gray-600">
        <TrendingDown size={24} className="mb-2 text-gray-700" />
        <p className="text-xs">Performance metrics will appear as you run queries</p>
      </div>
    )
  }

  const data = completed.map((m, i) => ({
    query: i + 1,
    attempts: m.attempts,
    success: m.status === 'done' && m.feedback !== 'wrong' ? 1 : 0,
    gen: m.promptGeneration,
  }))

  // Rolling success rate (window of 5)
  const dataWithRate = data.map((d, i) => {
    const window = data.slice(Math.max(0, i - 4), i + 1)
    const rate = Math.round((window.filter(w => w.success).length / window.length) * 100)
    return { ...d, successRate: rate }
  })

  const totalQueries = completed.length
  const correctCount = completed.filter(m => m.status === 'done' && m.feedback !== 'wrong').length
  const avgAttempts = (completed.reduce((s, m) => s + m.attempts, 0) / totalQueries).toFixed(1)
  const successRate = Math.round((correctCount / totalQueries) * 100)

  // Find query indices where generation changed (optimization happened)
  const genChangeIndices: { index: number; gen: number }[] = []
  for (let i = 1; i < data.length; i++) {
    if (data[i].gen > data[i - 1].gen) {
      genChangeIndices.push({ index: i + 1, gen: data[i].gen })
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Stats row */}
      <div className="grid grid-cols-3 gap-2">
        {[
          { label: 'Queries', value: totalQueries, color: 'text-blue-400' },
          { label: 'Avg Attempts', value: avgAttempts, color: 'text-orange-400' },
          { label: 'Accuracy', value: `${successRate}%`, color: 'text-green-400' },
        ].map((s) => (
          <div key={s.label} className="bg-white/5 rounded-xl p-2.5 text-center">
            <div className={`text-lg font-bold font-mono ${s.color}`}>{s.value}</div>
            <div className="text-[10px] text-gray-500">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Attempts chart */}
      <div>
        <div className="text-[10px] text-gray-500 mb-2 font-medium">Attempts per Query (lower = better)</div>
        <ResponsiveContainer width="100%" height={120}>
          <LineChart data={dataWithRate} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#ffffff08" />
            <XAxis dataKey="query" tick={{ fontSize: 9, fill: '#6b7280' }} />
            <YAxis domain={[0, 5]} tick={{ fontSize: 9, fill: '#6b7280' }} />
            <Tooltip content={<CustomTooltip />} />
            {genChangeIndices.map(({ index, gen }) => (
              <ReferenceLine
                key={gen}
                x={index}
                stroke="#8b5cf6"
                strokeDasharray="3 3"
                label={{ value: `G${gen}`, fill: '#8b5cf6', fontSize: 9 }}
              />
            ))}
            <Line
              type="monotone"
              dataKey="attempts"
              name="Attempts"
              stroke="#f97316"
              strokeWidth={2}
              dot={{ fill: '#f97316', r: 2 }}
              activeDot={{ r: 4 }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Success rate chart */}
      {completed.length >= 3 && (
        <div>
          <div className="text-[10px] text-gray-500 mb-2 font-medium">Rolling Accuracy % (5-query window)</div>
          <ResponsiveContainer width="100%" height={90}>
            <LineChart data={dataWithRate} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#ffffff08" />
              <XAxis dataKey="query" tick={{ fontSize: 9, fill: '#6b7280' }} />
              <YAxis domain={[0, 100]} tick={{ fontSize: 9, fill: '#6b7280' }} />
              <Tooltip content={<CustomTooltip />} />
              {genChangeIndices.map(({ index, gen }) => (
                <ReferenceLine
                  key={gen}
                  x={index}
                  stroke="#8b5cf6"
                  strokeDasharray="3 3"
                />
              ))}
              <Line
                type="monotone"
                dataKey="successRate"
                name="Accuracy %"
                stroke="#22c55e"
                strokeWidth={2}
                dot={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  )
}
