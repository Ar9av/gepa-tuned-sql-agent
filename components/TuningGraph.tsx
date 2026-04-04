'use client'

import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine,
} from 'recharts'
import { TrendingUp, Info } from 'lucide-react'
import { useDemoStore } from '@/store/demo-store'

const CustomTooltip = ({
  active,
  payload,
  label,
}: {
  active?: boolean
  payload?: { value: number; name: string; color: string }[]
  label?: string
}) => {
  if (active && payload?.length) {
    return (
      <div className="bg-gray-900 border border-white/10 rounded-lg px-3 py-2 text-xs">
        <p className="text-gray-400 mb-1">{label}</p>
        {payload.map(p => (
          <p key={p.name} style={{ color: p.color }}>
            Score: <span className="font-semibold">{(p.value * 100).toFixed(0)}%</span>
          </p>
        ))}
      </div>
    )
  }
  return null
}

export function TuningGraph() {
  const { gepaRuns, currentGeneration } = useDemoStore()

  const currentScore = gepaRuns.length > 0
    ? gepaRuns[gepaRuns.length - 1].score
    : null

  if (gepaRuns.length === 0) {
    return (
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <TrendingUp size={14} className="text-violet-400" />
          <span className="text-xs font-semibold text-white/70">Tuning Progress</span>
          <div className="group relative ml-auto">
            <Info size={11} className="text-gray-600 cursor-help" />
            <div className="absolute right-0 top-5 w-48 bg-gray-900 border border-white/10 rounded-lg px-2.5 py-2 text-[10px] text-gray-400 leading-relaxed hidden group-hover:block z-10">
              Shows GEPA optimization score over time. Triggered by user feedback or after every 4 queries.
            </div>
          </div>
        </div>
        <div className="flex flex-col items-center justify-center h-28 text-gray-700 text-center">
          <TrendingUp size={20} className="mb-2 text-gray-800" />
          <p className="text-[10px] leading-relaxed">
            Run benchmark or give feedback<br />to see tuning progress
          </p>
        </div>
      </div>
    )
  }

  const data = gepaRuns.map(run => ({
    label: run.label,
    score: run.score,
    generation: run.generation,
  }))

  return (
    <div className="flex flex-col gap-3">
      {/* Header */}
      <div className="flex items-center gap-2">
        <TrendingUp size={14} className="text-violet-400" />
        <span className="text-xs font-semibold text-white/70">Tuning Progress</span>
        <div className="group relative ml-auto">
          <Info size={11} className="text-gray-600 cursor-help" />
          <div className="absolute right-0 top-5 w-48 bg-gray-900 border border-white/10 rounded-lg px-2.5 py-2 text-[10px] text-gray-400 leading-relaxed hidden group-hover:block z-10">
            Shows GEPA optimization score over time. Triggered by user feedback or after every 4 queries.
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-2">
        <div className="bg-white/5 rounded-xl p-2.5 text-center">
          <div className="text-lg font-bold font-mono text-violet-400">Gen {currentGeneration}</div>
          <div className="text-xs text-gray-500">Current Gen</div>
        </div>
        <div className="bg-white/5 rounded-xl p-2.5 text-center">
          <div className="text-lg font-bold font-mono text-green-400">
            {currentScore !== null ? `${(currentScore * 100).toFixed(0)}%` : '—'}
          </div>
          <div className="text-xs text-gray-500">Best Score</div>
        </div>
      </div>

      {/* Chart */}
      <div>
        <div className="text-xs text-gray-500 mb-2 font-medium">Score over generations</div>
        <ResponsiveContainer width="100%" height={130}>
          <LineChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#ffffff08" />
            <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#6b7280' }} />
            <YAxis
              domain={[0, 1]}
              tick={{ fontSize: 10, fill: '#6b7280' }}
              tickFormatter={(v: number) => `${(v * 100).toFixed(0)}%`}
            />
            <Tooltip content={<CustomTooltip />} />
            <ReferenceLine y={0.25} stroke="#ffffff10" strokeDasharray="2 4" />
            <ReferenceLine y={0.5} stroke="#ffffff10" strokeDasharray="2 4" />
            <ReferenceLine y={0.75} stroke="#ffffff10" strokeDasharray="2 4" />
            <Line
              type="monotone"
              dataKey="score"
              name="Score"
              stroke="#8b5cf6"
              strokeWidth={2}
              dot={{ fill: '#8b5cf6', r: 3 }}
              activeDot={{ r: 5 }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
