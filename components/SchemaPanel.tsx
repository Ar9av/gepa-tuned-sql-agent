'use client'

import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Database, Loader2, CheckCircle2, Table, Layers, Play, ChevronDown } from 'lucide-react'
import { useDemoStore } from '@/store/demo-store'

const SCHEMAS = [
  { id: 'ecommerce', label: 'E-commerce', icon: '🛒', desc: 'customers · orders · products · reviews' },
  { id: 'hospital', label: 'Hospital', icon: '🏥', desc: 'patients · visits · diagnoses · labs' },
  { id: 'banking', label: 'Banking', icon: '🏦', desc: 'accounts · transactions · loans · fraud' },
]

const DATA_SIZES = [
  { value: 500 as const, label: '500', sublabel: 'Quick' },
  { value: 2000 as const, label: '2K', sublabel: 'Demo' },
  { value: 10000 as const, label: '10K', sublabel: 'Large' },
]

export function SchemaPanel({ onTabChange }: { onTabChange?: (tab: string) => void }) {
  const {
    schemaType, schemaScript, tableStats, schemaLoading, schemaStatus,
    dataSize, populatingData, populateStatus, populateScript,
    setSchemaType, appendSchemaChunk, setSchemaStatus, setTableStats,
    setSchemaLoading, setSchemaGraph,
    setDataSize, setPopulatingData, appendPopulateChunk, setPopulateStatus, resetPopulateScript,
  } = useDemoStore()

  const [showScript, setShowScript] = useState(false)
  const [showPopulateScript, setShowPopulateScript] = useState(false)

  async function handleGenerate(type: string) {
    if (schemaLoading) return
    setSchemaType(type)
    setSchemaLoading(true)

    const res = await fetch('/api/generate-schema', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ schemaType: type }),
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
        try {
          const event = JSON.parse(line.slice(6))
          if (event.type === 'script_chunk') appendSchemaChunk(event.chunk)
          if (event.type === 'status') setSchemaStatus(event.message)
          if (event.type === 'warning') {} // silently ignore
          if (event.type === 'done') {
            setTableStats(event.tableStats)
            if (event.schemaGraph) setSchemaGraph(event.schemaGraph)
            setSchemaLoading(false)
            setSchemaStatus('')
          }
          if (event.type === 'error') {
            setSchemaStatus('Error: ' + event.message)
            setSchemaLoading(false)
          }
        } catch {}
      }
    }
  }

  async function handlePopulate() {
    if (populatingData || tableStats.length === 0) return
    setPopulatingData(true)
    resetPopulateScript()

    const res = await fetch('/api/populate-data', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rowCount: dataSize }),
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
        try {
          const event = JSON.parse(line.slice(6))
          if (event.type === 'script_chunk') appendPopulateChunk(event.chunk)
          if (event.type === 'status') setPopulateStatus(event.message)
          if (event.type === 'done') {
            setTableStats(event.tableStats)
            setPopulatingData(false)
            setPopulateStatus('')
            // refresh schema graph with updated row counts
            fetch('/api/schema-graph').then(r => r.json()).then(g => setSchemaGraph(g))
            onTabChange?.('browser')
          }
          if (event.type === 'error') {
            setPopulateStatus('Error: ' + event.message)
            setPopulatingData(false)
          }
        } catch {}
      }
    }
  }

  const busy = schemaLoading || populatingData
  const hasSchema = tableStats.length > 0
  const totalRows = tableStats.reduce((s, t) => s + t.rows, 0)

  return (
    <div className="flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-center gap-2 text-xs font-semibold text-gray-400 uppercase tracking-widest">
        <Database size={13} className="text-violet-400" />
        Schema
      </div>

      {/* Schema type buttons */}
      <div className="flex flex-col gap-1.5">
        {SCHEMAS.map((s) => (
          <button
            key={s.id}
            onClick={() => !busy && handleGenerate(s.id)}
            disabled={busy}
            className={`
              flex items-center gap-3 p-3 rounded-xl border text-left transition-all duration-200 group
              ${schemaType === s.id
                ? 'border-violet-500/60 bg-violet-500/10'
                : 'border-white/5 bg-white/3 hover:border-white/15 hover:bg-white/5'
              }
              ${busy ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
            `}
          >
            <span className="text-lg leading-none">{s.icon}</span>
            <div className="min-w-0">
              <div className={`text-xs font-semibold ${schemaType === s.id ? 'text-violet-300' : 'text-gray-300'}`}>
                {s.label}
              </div>
              <div className="text-[10px] text-gray-600 truncate mt-0.5">{s.desc}</div>
            </div>
            {schemaType === s.id && schemaLoading && (
              <Loader2 size={12} className="ml-auto text-violet-400 animate-spin shrink-0" />
            )}
            {schemaType === s.id && !schemaLoading && hasSchema && (
              <CheckCircle2 size={12} className="ml-auto text-green-400 shrink-0" />
            )}
          </button>
        ))}
      </div>

      {/* Status */}
      <AnimatePresence>
        {(schemaStatus || populateStatus) && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="flex items-center gap-2 text-violet-300 text-xs">
            <Loader2 size={11} className="animate-spin shrink-0" />
            {schemaStatus || populateStatus}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Table stats */}
      <AnimatePresence>
        {hasSchema && (
          <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="text-xs text-gray-500">{tableStats.length} tables · {totalRows.toLocaleString()} rows</span>
              <button onClick={() => setShowScript(!showScript)} className="text-[10px] text-gray-600 hover:text-gray-400 transition-colors">
                {showScript ? 'hide' : 'view script'}
              </button>
            </div>
            <div className="grid grid-cols-2 gap-1">
              {tableStats.filter(t => !t.name.startsWith('sqlite_')).map((t) => (
                <div key={t.name} className="flex items-center gap-1.5 bg-white/3 rounded-lg px-2 py-1.5 border border-white/5">
                  <Table size={9} className="text-violet-400 shrink-0" />
                  <span className="text-[10px] text-gray-400 font-mono truncate flex-1">{t.name}</span>
                  <span className="text-[10px] text-gray-600 tabular-nums">{t.rows.toLocaleString()}</span>
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Script viewer */}
      <AnimatePresence>
        {(showScript || schemaLoading) && schemaScript && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 160 }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
            <pre className="h-full overflow-auto text-[10px] font-mono text-green-300/70 bg-black/40 rounded-xl p-3 border border-white/5 leading-relaxed">
              {schemaScript}{schemaLoading && <span className="animate-pulse text-green-400">█</span>}
            </pre>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Data Population */}
      <AnimatePresence>
        {hasSchema && (
          <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col gap-2 border-t border-white/5 pt-4">
            <div className="flex items-center gap-2 text-xs font-semibold text-gray-400 uppercase tracking-widest">
              <Layers size={11} className="text-violet-400" />
              Populate Data
            </div>

            {/* Size picker */}
            <div className="flex gap-1.5">
              {DATA_SIZES.map(({ value, label, sublabel }) => (
                <button key={value} onClick={() => setDataSize(value)} disabled={populatingData}
                  className={`flex-1 py-2 rounded-xl border text-center transition-all duration-150 disabled:opacity-50
                    ${dataSize === value ? 'border-violet-500/60 bg-violet-500/15' : 'border-white/5 bg-white/3 hover:border-white/15'}`}>
                  <div className={`text-xs font-bold ${dataSize === value ? 'text-violet-300' : 'text-gray-300'}`}>{label}</div>
                  <div className="text-[10px] text-gray-600">{sublabel}</div>
                </button>
              ))}
            </div>

            <button onClick={handlePopulate} disabled={busy}
              className="flex items-center justify-center gap-2 py-2.5 rounded-xl bg-violet-600 hover:bg-violet-500 disabled:opacity-40 disabled:cursor-not-allowed transition-all text-white text-xs font-semibold">
              {populatingData ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} />}
              {populatingData ? 'Generating...' : 'Generate Data'}
            </button>

            {/* Populate script preview */}
            {populateScript && (
              <div>
                <button onClick={() => setShowPopulateScript(!showPopulateScript)}
                  className="flex items-center gap-1 text-[10px] text-gray-600 hover:text-gray-400 transition-colors mb-1">
                  <ChevronDown size={10} className={`transition-transform ${showPopulateScript ? 'rotate-180' : ''}`} />
                  {showPopulateScript ? 'hide' : 'view'} population script
                </button>
                <AnimatePresence>
                  {showPopulateScript && (
                    <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 140, opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                      <pre className="h-full overflow-auto text-[10px] font-mono text-blue-300/70 bg-black/40 rounded-xl p-3 border border-white/5 leading-relaxed">
                        {populateScript}{populatingData && <span className="animate-pulse">█</span>}
                      </pre>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
