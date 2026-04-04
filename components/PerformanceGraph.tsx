'use client'

import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine, Legend,
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
            {p.name}: <span className="font-semibold">{p.value}</span>
          </p>
        ))}
      </div>
    )
  }
  return null
}

export function PerformanceGraph() {
  const { queryHistory, optimizations } = useDemoStore()

  if (queryHistory.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-40 text-gray-600">
        <TrendingDown size={24} className="mb-2 text-gray-700" />
        <p className="text-xs">Performance metrics will appear as you run queries</p>
      </div>
    )
  }

  const data = queryHistory.map((q, i) => ({
    query: i + 1,
    attempts: q.attempts.length,
    success: q.success ? 1 : 0,
  }))

  // Rolling success rate (window of 3)
  const dataWithRate = data.map((d, i) => {
    const window = data.slice(Math.max(0, i - 2), i + 1)
    const rate = Math.round((window.filter(w => w.success).length / window.length) * 100)
    return { ...d, successRate: rate }
  })

  const avgAttempts = (queryHistory.reduce((s, q) => s + q.attempts.length, 0) / queryHistory.length).toFixed(1)
  const successRate = Math.round((queryHistory.filter(q => q.success).length / queryHistory.length) * 100)

  return (
    <div className="flex flex-col gap-3">
      {/* Stats row */}
      <div className="grid grid-cols-3 gap-2">
        {[
          { label: 'Queries Run', value: queryHistory.length, color: 'text-blue-400' },
          { label: 'Avg Attempts', value: avgAttempts, color: 'text-orange-400' },
          { label: 'Success Rate', value: `${successRate}%`, color: 'text-green-400' },
        ].map((s) => (
          <div key={s.label} className="bg-white/5 rounded-xl p-2.5 text-center">
            <div className={`text-lg font-bold font-mono ${s.color}`}>{s.value}</div>
            <div className="text-xs text-gray-500">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Attempts chart */}
      <div>
        <div className="text-xs text-gray-500 mb-2 font-medium">Attempts per Query (lower = better)</div>
        <ResponsiveContainer width="100%" height={140}>
          <LineChart data={dataWithRate} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#ffffff08" />
            <XAxis dataKey="query" tick={{ fontSize: 10, fill: '#6b7280' }} />
            <YAxis domain={[1, 5]} tick={{ fontSize: 10, fill: '#6b7280' }} />
            <Tooltip content={<CustomTooltip />} />
            {optimizations.map((opt) => (
              <ReferenceLine
                key={opt.generation}
                x={opt.queryIndex}
                stroke="#8b5cf6"
                strokeDasharray="3 3"
                label={{ value: `G${opt.generation}`, fill: '#8b5cf6', fontSize: 9 }}
              />
            ))}
            <Line
              type="monotone"
              dataKey="attempts"
              name="Attempts"
              stroke="#f97316"
              strokeWidth={2}
              dot={{ fill: '#f97316', r: 3 }}
              activeDot={{ r: 5 }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Success rate chart */}
      {queryHistory.length >= 3 && (
        <div>
          <div className="text-xs text-gray-500 mb-2 font-medium">Rolling Success Rate % (3-query window)</div>
          <ResponsiveContainer width="100%" height={100}>
            <LineChart data={dataWithRate} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#ffffff08" />
              <XAxis dataKey="query" tick={{ fontSize: 10, fill: '#6b7280' }} />
              <YAxis domain={[0, 100]} tick={{ fontSize: 10, fill: '#6b7280' }} />
              <Tooltip content={<CustomTooltip />} />
              {optimizations.map((opt) => (
                <ReferenceLine
                  key={opt.generation}
                  x={opt.queryIndex}
                  stroke="#8b5cf6"
                  strokeDasharray="3 3"
                />
              ))}
              <Line
                type="monotone"
                dataKey="successRate"
                name="Success %"
                stroke="#22c55e"
                strokeWidth={2}
                dot={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* GEPA events */}
      {optimizations.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <div className="text-xs text-gray-500 font-medium">GEPA Optimizations</div>
          {optimizations.map((opt) => (
            <div key={opt.generation} className="flex items-start gap-2 bg-violet-500/10 rounded-lg px-2.5 py-2 border border-violet-500/20">
              <span className="text-xs font-mono text-violet-400 shrink-0">G{opt.generation}</span>
              <span className="text-xs text-violet-200/60 leading-relaxed line-clamp-2">{opt.reflection}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
