'use client'

import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Zap, GitFork, Table2, Code2, Target } from 'lucide-react'

import { DatasetPanel } from '@/components/DatasetPanel'
import { BenchmarkPanel } from '@/components/BenchmarkPanel'
import { PerformanceGraph } from '@/components/PerformanceGraph'
import { PromptEvolution } from '@/components/PromptEvolution'
import { ERDiagram } from '@/components/ERDiagram'
import { TableBrowser } from '@/components/TableBrowser'
import { SQLPlayground } from '@/components/SQLPlayground'
import { useDemoStore } from '@/store/demo-store'

type Tab = 'benchmark' | 'er' | 'browser' | 'playground'

const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
  { id: 'benchmark', label: 'Benchmark', icon: <Target size={12} /> },
  { id: 'er', label: 'ER Diagram', icon: <GitFork size={12} /> },
  { id: 'browser', label: 'Browse Data', icon: <Table2 size={12} /> },
  { id: 'playground', label: 'SQL', icon: <Code2 size={12} /> },
]

export default function Home() {
  const [activeTab, setActiveTab] = useState<Tab>('benchmark')
  const { setDbSeeded, setTableStats, setSchemaGraph } = useDemoStore()

  useEffect(() => {
    fetch('/api/init')
      .then(r => r.json())
      .then((d: { seeded: boolean; tables: { name: string; rows: number }[] }) => {
        setDbSeeded(true)
        setTableStats(d.tables)
        // Also load schema graph
        fetch('/api/schema-graph')
          .then(r => r.json())
          .then(g => setSchemaGraph(g))
          .catch(() => {})
      })
      .catch(() => {})
  }, [setDbSeeded, setTableStats, setSchemaGraph])

  return (
    <div className="min-h-screen bg-[#08080d] text-white flex flex-col" style={{ fontFamily: 'ui-monospace, "SF Mono", Consolas, monospace' }}>
      {/* Header */}
      <header className="border-b border-white/[0.06] px-5 py-3 flex items-center justify-between shrink-0 bg-[#09090f]/80 backdrop-blur-sm sticky top-0 z-50">
        <div className="flex items-center gap-3">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-violet-500 to-violet-700 flex items-center justify-center shadow-lg shadow-violet-500/20">
            <Zap size={13} className="text-white" />
          </div>
          <div>
            <h1 className="text-sm font-bold text-white tracking-tight">SQL Agent</h1>
            <p className="text-[10px] text-gray-600">Self-debugging &middot; GEPA prompt evolution</p>
          </div>
        </div>
      </header>

      {/* Body: 3-column layout */}
      <div className="flex flex-1 overflow-hidden">

        {/* LEFT SIDEBAR */}
        <aside className="w-60 shrink-0 border-r border-white/[0.06] flex flex-col overflow-y-auto bg-[#09090f]">
          <div className="flex-1 p-4 flex flex-col gap-5">
            <DatasetPanel />
          </div>
        </aside>

        {/* CENTRE: Tabbed panel */}
        <main className="flex-1 flex flex-col overflow-hidden">
          {/* Tab bar */}
          <div className="flex items-center gap-1 px-4 py-2.5 border-b border-white/[0.06] bg-[#09090f] shrink-0">
            {TABS.map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-150
                  ${activeTab === tab.id
                    ? 'bg-violet-600/20 text-violet-300 border border-violet-500/30'
                    : 'text-gray-500 hover:text-gray-300 hover:bg-white/5 border border-transparent'
                  }`}
              >
                {tab.icon}
                {tab.label}
              </button>
            ))}
          </div>

          {/* Tab content */}
          <div className="flex-1 overflow-hidden relative">
            <AnimatePresence mode="wait">
              <motion.div
                key={activeTab}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.15 }}
                className="absolute inset-0 flex flex-col overflow-hidden"
              >
                {activeTab === 'benchmark' && <BenchmarkPanel />}
                {activeTab === 'er' && <ERDiagram />}
                {activeTab === 'browser' && <TableBrowser />}
                {activeTab === 'playground' && <SQLPlayground />}
              </motion.div>
            </AnimatePresence>
          </div>
        </main>

        {/* RIGHT SIDEBAR */}
        <aside className="w-72 shrink-0 border-l border-white/[0.06] flex flex-col overflow-y-auto bg-[#09090f]">
          <div className="p-4 border-b border-white/[0.06]">
            <PromptEvolution />
          </div>
          <div className="p-4 border-b border-white/[0.06]">
            <div className="flex items-center gap-2 text-[10px] font-semibold text-gray-500 uppercase tracking-widest mb-3">
              <Zap size={10} className="text-violet-400" />
              Learning Progress
            </div>
            <PerformanceGraph />
          </div>
        </aside>
      </div>
    </div>
  )
}
