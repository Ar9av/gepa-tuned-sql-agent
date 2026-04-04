'use client'

import { motion, AnimatePresence } from 'framer-motion'
import { Database, Table } from 'lucide-react'
import { useDemoStore } from '@/store/demo-store'

export function DatasetPanel() {
  const { tableStats } = useDemoStore()
  const hasSchema = tableStats.length > 0
  const totalRows = tableStats.reduce((s, t) => s + t.rows, 0)

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

      {/* Footer note */}
      <div className="text-[10px] text-gray-600 flex items-center gap-1.5">
        <span className="w-1.5 h-1.5 rounded-full bg-green-500/60 shrink-0" />
        Dataset pre-loaded &middot; {tableStats.filter(t => !t.name.startsWith('sqlite_')).length} tables
      </div>
    </div>
  )
}
