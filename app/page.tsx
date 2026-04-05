'use client'

import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Zap, GitFork, Table2, Code2, Target, Database, MessageSquare, PanelLeftOpen, PanelRightOpen, X, Sun, Moon } from 'lucide-react'

import { DatasetPanel } from '@/components/DatasetPanel'
import { BenchmarkPanel } from '@/components/BenchmarkPanel'
import { PerformanceGraph } from '@/components/PerformanceGraph'
import { PromptEvolution } from '@/components/PromptEvolution'
import { ERDiagram } from '@/components/ERDiagram'
import { TableBrowser } from '@/components/TableBrowser'
import { SQLPlayground } from '@/components/SQLPlayground'
import { ConnectModal } from '@/components/ConnectModal'
import { PromptDiffModal } from '@/components/PromptDiffModal'
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
  const [leftOpen, setLeftOpen] = useState(false)
  const [rightOpen, setRightOpen] = useState(false)
  const [theme, setTheme] = useState<'dark' | 'light'>('dark')

  // Apply theme to document
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    // Persist preference
    try { localStorage.setItem('theme', theme) } catch {}
  }, [theme])

  // Load persisted theme on mount
  useEffect(() => {
    try {
      const saved = localStorage.getItem('theme') as 'dark' | 'light' | null
      if (saved) setTheme(saved)
    } catch {}
  }, [])
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

  // Close mobile sidebars on tab change
  useEffect(() => {
    setLeftOpen(false)
    setRightOpen(false)
  }, [activeTab])

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
    <div className="min-h-screen flex flex-col theme-bg-primary theme-text-primary" style={{ fontFamily: 'ui-monospace, "SF Mono", Consolas, monospace' }}>
      {/* Header */}
      <header className="border-b px-3 sm:px-5 py-3 flex items-center justify-between shrink-0 backdrop-blur-sm sticky top-0 z-50 theme-border" style={{ background: 'var(--bg-secondary)' }}>
        <div className="flex items-center gap-2 sm:gap-3">
          {/* Mobile sidebar toggles */}
          <button
            onClick={() => { setLeftOpen(!leftOpen); setRightOpen(false) }}
            className="lg:hidden flex items-center gap-1 px-2 py-1.5 rounded-lg hover:bg-white/5 text-gray-400 hover:text-white transition-colors text-[10px]"
          >
            <PanelLeftOpen size={14} />
            <span className="hidden sm:inline">Data</span>
          </button>

          <div className="w-7 h-7 rounded-lg flex items-center justify-center shadow-lg" style={{ background: '#1e3a5f', boxShadow: '0 4px 12px rgba(30,58,95,0.3)' }}>
            <Zap size={13} className="text-white" />
          </div>
          <div>
            <h1 className="text-sm font-bold text-white tracking-tight">SQL Agent</h1>
            <p className="text-[10px] text-gray-600 hidden sm:block">Self-debugging &middot; GEPA prompt evolution</p>
          </div>
        </div>

        <div className="flex items-center gap-2 sm:gap-3">
          {/* Connection status */}
          {activeConnection && connectionStatus === 'connected' && (
            <div className="hidden sm:flex items-center gap-1.5 text-[10px] text-green-400">
              <span className="w-1.5 h-1.5 rounded-full bg-green-400 inline-block" />
              connected: {activeConnection.name}
            </div>
          )}
          {connectionStatus === 'connecting' && (
            <div className="flex items-center gap-1.5 text-[10px] text-amber-400">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-400 inline-block animate-pulse" />
              <span className="hidden sm:inline">connecting...</span>
            </div>
          )}

          {/* Theme toggle */}
          <button
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            className="p-1.5 rounded-lg hover:bg-[var(--bg-hover-strong)] transition-colors theme-text-muted"
            title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          >
            {theme === 'dark' ? <Sun size={14} /> : <Moon size={14} />}
          </button>

          {/* Connect DB button */}
          <button
            onClick={() => setConnectModalOpen(true)}
            className="flex items-center gap-1.5 px-2 sm:px-3 py-1.5 text-xs font-medium rounded-lg transition-all theme-border-secondary"
            style={{ background: 'var(--bg-hover)', color: 'var(--text-secondary)', borderWidth: 1 }}
          >
            <Database size={13} />
            <span className="hidden sm:inline">Connect DB</span>
          </button>

          {/* Mobile right sidebar toggle */}
          <button
            onClick={() => { setRightOpen(!rightOpen); setLeftOpen(false) }}
            className="lg:hidden flex items-center gap-1 px-2 py-1.5 rounded-lg hover:bg-white/5 text-gray-400 hover:text-white transition-colors text-[10px]"
          >
            <span className="hidden sm:inline">GEPA</span>
            <PanelRightOpen size={14} />
          </button>
        </div>
      </header>

      {/* Body: 3-column layout */}
      <div className="flex flex-1 overflow-hidden relative">

        {/* Mobile overlay backdrop */}
        {(leftOpen || rightOpen) && (
          <div
            className="fixed inset-0 bg-black/50 z-30 lg:hidden"
            onClick={() => { setLeftOpen(false); setRightOpen(false) }}
          />
        )}

        {/* LEFT SIDEBAR — desktop: inline, mobile: overlay */}
        <aside className={`
          fixed top-[53px] bottom-0 left-0 z-40 w-64 theme-bg-secondary border-r theme-border flex flex-col overflow-y-auto
          transition-transform duration-200 ease-out
          lg:static lg:w-60 lg:shrink-0 lg:translate-x-0 lg:z-auto theme-bg-secondary
          ${leftOpen ? 'translate-x-0' : '-translate-x-full'}
        `}>
          <div className="flex items-center justify-between px-4 pt-3 lg:hidden">
            <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Dataset</span>
            <button onClick={() => setLeftOpen(false)} className="p-1 rounded hover:bg-white/5 text-gray-500">
              <X size={14} />
            </button>
          </div>
          <div className="flex-1 p-4 flex flex-col gap-5">
            <DatasetPanel />
          </div>
        </aside>

        {/* CENTRE: Tabbed panel */}
        <main className="flex-1 flex flex-col overflow-hidden min-w-0">
          {/* Tab bar — scrollable on mobile */}
          <div className="flex items-center gap-1 px-2 sm:px-4 py-2.5 border-b theme-border theme-bg-secondary shrink-0 overflow-x-auto scrollbar-none">
            {ALL_TABS.filter(tab => !tab.benchmarkOnly || (activeConnection?.name === 'Benchmark DB')).map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-150 whitespace-nowrap shrink-0
                  ${activeTab === tab.id
                    ? 'bg-violet-600/20 text-violet-300 border border-violet-500/30'
                    : 'text-gray-500 hover:text-gray-300 hover:bg-white/5 border border-transparent'
                  }`}
              >
                {tab.icon}
                <span className="hidden xs:inline sm:inline">{tab.label}</span>
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

        {/* RIGHT SIDEBAR — desktop: inline, mobile: overlay */}
        <aside className={`
          fixed top-[53px] bottom-0 right-0 z-40 w-72 theme-bg-secondary border-l theme-border flex flex-col overflow-y-auto
          transition-transform duration-200 ease-out
          lg:static lg:shrink-0 lg:translate-x-0 lg:z-auto
          ${rightOpen ? 'translate-x-0' : 'translate-x-full'}
        `}>
          <div className="flex items-center justify-between px-4 pt-3 lg:hidden">
            <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">GEPA</span>
            <button onClick={() => setRightOpen(false)} className="p-1 rounded hover:bg-white/5 text-gray-500">
              <X size={14} />
            </button>
          </div>
          <div className="p-4 border-b theme-border">
            <PromptEvolution />
          </div>
          <div className="p-4 border-b theme-border">
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

      {/* Modals */}
      <ConnectModal onConnect={handleConnect} />
      <PromptDiffModal />
    </div>
  )
}
