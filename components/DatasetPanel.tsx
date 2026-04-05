'use client'

import { useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Database, Table, FileText, X, Upload, ChevronDown, ChevronUp } from 'lucide-react'
import { useDemoStore } from '@/store/demo-store'

export function DatasetPanel() {
  const { tableStats, businessContext, businessContextName, setBusinessContext } = useDemoStore()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [contextExpanded, setContextExpanded] = useState(false)

  const hasSchema = tableStats.length > 0
  const totalRows = tableStats.reduce((s, t) => s + t.rows, 0)

  function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      setBusinessContext(reader.result as string, file.name)
    }
    reader.readAsText(file)
    e.target.value = ''
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-center gap-2 text-xs font-semibold text-gray-400 uppercase tracking-widest">
        <Database size={13} className="text-violet-400" />
        Benchmark Dataset
      </div>

      {/* Description */}
      <div className="flex flex-col gap-1.5">
        <div className="text-xs font-semibold text-white/80">Marketplace Analytics Platform</div>
        <div className="text-[10px] text-gray-500 leading-relaxed">
          16-table marketplace with vendors, hierarchical categories, orders, inventory logs &amp; promotions
        </div>
      </div>

      {/* Table stats */}
      <AnimatePresence>
        {hasSchema && (
          <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="text-xs text-gray-500">{tableStats.length} tables &middot; {totalRows.toLocaleString()} rows</span>
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

      {/* Business Context Upload */}
      <div className="border-t border-white/5 pt-3 flex flex-col gap-2">
        <div className="flex items-center gap-2 text-[10px] font-semibold text-gray-500 uppercase tracking-widest">
          <FileText size={10} className="text-violet-400" />
          Business Context
        </div>

        {businessContext ? (
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-green-400/70 truncate flex-1">
                {businessContextName ?? 'context.txt'}
              </span>
              <button
                onClick={() => setBusinessContext('', null)}
                className="text-gray-600 hover:text-red-400 transition-colors p-0.5"
              >
                <X size={10} />
              </button>
            </div>
            <pre className={`text-[9px] text-gray-500 bg-white/[0.02] rounded-lg px-2 py-1.5 border border-white/5 overflow-y-auto whitespace-pre-wrap leading-relaxed ${contextExpanded ? 'max-h-60' : 'max-h-24'}`}>
              {contextExpanded ? businessContext : businessContext.slice(0, 500)}{!contextExpanded && businessContext.length > 500 ? '...' : ''}
            </pre>
            {businessContext.length > 500 && (
              <button
                onClick={() => setContextExpanded(!contextExpanded)}
                className="flex items-center gap-1 text-[9px] text-violet-400/70 hover:text-violet-300 transition-colors"
              >
                {contextExpanded ? <ChevronUp size={9} /> : <ChevronDown size={9} />}
                {contextExpanded ? 'Show less' : `Show all (${businessContext.length.toLocaleString()} chars)`}
              </button>
            )}
          </div>
        ) : (
          <button
            onClick={() => fileInputRef.current?.click()}
            className="flex items-center justify-center gap-1.5 py-2 rounded-lg border border-dashed border-white/10 hover:border-violet-500/40 hover:bg-violet-500/5 transition-all text-[10px] text-gray-500 hover:text-violet-300"
          >
            <Upload size={10} />
            Upload .md or .txt
          </button>
        )}

        <input
          ref={fileInputRef}
          type="file"
          accept=".md,.txt,.markdown"
          className="hidden"
          onChange={handleFileUpload}
        />
        <div className="text-[9px] text-gray-700 leading-relaxed">
          Add domain knowledge the AI uses when reasoning about queries
        </div>
      </div>

      {/* Footer note */}
      <div className="text-[10px] text-gray-600 flex items-center gap-1.5">
        <span className="w-1.5 h-1.5 rounded-full bg-green-500/60 shrink-0" />
        Dataset pre-loaded &middot; {tableStats.filter(t => !t.name.startsWith('sqlite_')).length} tables
      </div>
    </div>
  )
}
