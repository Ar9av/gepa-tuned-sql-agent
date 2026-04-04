'use client'

import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Zap, GitFork, Table2, Code2, Target, Database, MessageSquare } from 'lucide-react'

import { DatasetPanel } from '@/components/DatasetPanel'
import { BenchmarkPanel } from '@/components/BenchmarkPanel'
import { PerformanceGraph } from '@/components/PerformanceGraph'
import { PromptEvolution } from '@/components/PromptEvolution'
import { ERDiagram } from '@/components/ERDiagram'
import { TableBrowser } from '@/components/TableBrowser'
import { SQLPlayground } from '@/components/SQLPlayground'
import { ConnectModal } from '@/components/ConnectModal'
import { ChatPanel } from '@/components/ChatPanel'
import { TuningGraph } from '@/components/TuningGraph'
import { useDemoStore } from '@/store/demo-store'
import type { SchemaGraph } from '@/lib/db'
import type { DBConfig } from '@/lib/connector'
import type { TableStat } from '@/store/demo-store'

type Tab = 'chat' | 'benchmark' | 'er' | 'browser' | 'playground'

const ALL_TABS: { id: Tab; label: string; icon: React.ReactNode; benchmarkOnly?: boolean }[] = [
  { id: 'chat', label: 'Chat', icon: <MessageSquare size={12} /> },
  { id: 'benchmark', label: 'Benchmark', icon: <Target size={12} />, benchmarkOnly: true },
  { id: 'er', label: 'ER Diagram', icon: <GitFork size={12} /> },
  { id: 'browser', label: 'Browse Data', icon: <Table2 size={12} /> },
  { id: 'playground', label: 'SQL', icon: <Code2 size={12} /> },
]

export default function Home() {
  const [activeTab, setActiveTab] = useState<Tab>('chat')
  const {
    setDbSeeded,
    setTableStats,
    setSchemaGraph,
    connectModalOpen,
    setConnectModalOpen,
    activeConnection,
    setActiveConnection,
    connectionStatus,
  } = useDemoStore()

  useEffect(() => {
    fetch('/api/init')
      .then(r => r.json())
      .then((d: { seeded: boolean; tables: { name: string; rows: number }[] }) => {
        setDbSeeded(true)
        setTableStats(d.tables)
        setActiveConnection({ type: 'sqlite', filename: '', name: 'Benchmark DB' })
        // Also load schema graph
        fetch('/api/schema-graph')
          .then(r => r.json())
          .then(g => setSchemaGraph(g))
          .catch(() => {})
      })
      .catch(() => {})
  }, [setDbSeeded, setTableStats, setSchemaGraph])

  function handleConnect(schemaGraph: SchemaGraph, tables: TableStat[], config: DBConfig) {
    setActiveConnection(config)
    setSchemaGraph(schemaGraph)
    setTableStats(tables)
    setActiveTab('chat')
  }

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

        <div className="flex items-center gap-3">
          {/* Connection status */}
          {activeConnection && connectionStatus === 'connected' && (
            <div className="flex items-center gap-1.5 text-[10px] text-green-400">
              <span className="w-1.5 h-1.5 rounded-full bg-green-400 inline-block" />
              connected: {activeConnection.name}
            </div>
          )}
          {connectionStatus === 'connecting' && (
            <div className="flex items-center gap-1.5 text-[10px] text-amber-400">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-400 inline-block animate-pulse" />
              connecting...
            </div>
          )}

          {/* Connect DB button */}
          <button
            onClick={() => setConnectModalOpen(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-white/[0.04] text-gray-300 border border-white/[0.08] rounded-lg hover:bg-white/[0.07] hover:border-white/[0.12] hover:text-white transition-all"
          >
            <Database size={13} />
            Connect DB
          </button>
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
            {ALL_TABS.filter(tab => !tab.benchmarkOnly || (activeConnection?.name === 'Benchmark DB')).map(tab => (
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
                {activeTab === 'chat' && <ChatPanel />}
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
              Tuning Progress
            </div>
            <TuningGraph />
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

      {/* Connect Modal */}
      <ConnectModal onConnect={handleConnect} />
    </div>
  )
}
