import { create } from 'zustand'
import type { SchemaGraph } from '@/lib/db'

export interface Attempt {
  number: number
  sql: string
  error?: string
  diagnosis?: string
  status: 'generating' | 'executing' | 'error' | 'success' | 'diagnosing'
}

export interface QueryRun {
  id: string
  question: string
  attempts: Attempt[]
  success: boolean
  rows?: Record<string, unknown>[]
  rowCount?: number
  finalSQL?: string
  timestamp: number
}

export interface TableStat { name: string; rows: number }
export interface OptimizationEvent { generation: number; reflection: string; newPrompt: string; queryIndex: number }

interface DemoStore {
  // Schema state
  schemaType: string | null
  schemaScript: string
  tableStats: TableStat[]
  schemaLoading: boolean
  schemaStatus: string
  schemaGraph: SchemaGraph | null

  // Data population
  dataSize: 500 | 2000 | 10000
  populatingData: boolean
  populateScript: string
  populateStatus: string

  // Query state
  currentQuery: QueryRun | null
  queryHistory: QueryRun[]
  isRunning: boolean

  // GEPA state
  currentPrompt: string
  optimizations: OptimizationEvent[]
  currentOptimization: { reflection: string; newPrompt: string } | null

  // SQL Playground
  playgroundSQL: string
  playgroundResult: { success: boolean; rows: Record<string, unknown>[]; rowCount: number; error?: string; timeMs?: number } | null
  playgroundRunning: boolean

  // Table browser
  selectedTable: string | null
  tableBrowserPage: number

  // Actions
  setSchemaType: (t: string) => void
  appendSchemaChunk: (chunk: string) => void
  setSchemaStatus: (s: string) => void
  setTableStats: (stats: TableStat[]) => void
  setSchemaLoading: (b: boolean) => void
  setSchemaGraph: (g: SchemaGraph | null) => void

  setDataSize: (n: 500 | 2000 | 10000) => void
  setPopulatingData: (b: boolean) => void
  appendPopulateChunk: (chunk: string) => void
  setPopulateStatus: (s: string) => void
  resetPopulateScript: () => void

  startQuery: (question: string) => void
  startAttempt: (n: number) => void
  appendSQLChunk: (chunk: string, attempt: number) => void
  setAttemptStatus: (attempt: number, status: Attempt['status']) => void
  setAttemptError: (attempt: number, error: string) => void
  appendDiagnosisChunk: (chunk: string, attempt: number) => void
  finishQuery: (success: boolean, rows?: Record<string, unknown>[], rowCount?: number, sql?: string) => void

  setOptimizationStart: () => void
  setOptimizationDone: (reflection: string, newPrompt: string) => void

  setPlaygroundSQL: (s: string) => void
  setPlaygroundResult: (r: DemoStore['playgroundResult']) => void
  setPlaygroundRunning: (b: boolean) => void

  setSelectedTable: (t: string | null) => void
  setTableBrowserPage: (n: number) => void
}

export const useDemoStore = create<DemoStore>((set, get) => ({
  schemaType: null,
  schemaScript: '',
  tableStats: [],
  schemaLoading: false,
  schemaStatus: '',
  schemaGraph: null,

  dataSize: 2000,
  populatingData: false,
  populateScript: '',
  populateStatus: '',

  currentQuery: null,
  queryHistory: [],
  isRunning: false,

  currentPrompt: '',
  optimizations: [],
  currentOptimization: null,

  playgroundSQL: '',
  playgroundResult: null,
  playgroundRunning: false,

  selectedTable: null,
  tableBrowserPage: 0,

  setSchemaType: (t) => set({ schemaType: t, schemaScript: '', schemaGraph: null }),
  appendSchemaChunk: (chunk) => set((s) => ({ schemaScript: s.schemaScript + chunk })),
  setSchemaStatus: (status) => set({ schemaStatus: status }),
  setTableStats: (tableStats) => set({ tableStats }),
  setSchemaLoading: (b) => set({ schemaLoading: b }),
  setSchemaGraph: (g) => set({ schemaGraph: g }),

  setDataSize: (n) => set({ dataSize: n }),
  setPopulatingData: (b) => set({ populatingData: b }),
  appendPopulateChunk: (chunk) => set((s) => ({ populateScript: s.populateScript + chunk })),
  setPopulateStatus: (s) => set({ populateStatus: s }),
  resetPopulateScript: () => set({ populateScript: '' }),

  startQuery: (question) => {
    const run: QueryRun = { id: Date.now().toString(), question, attempts: [], success: false, timestamp: Date.now() }
    set({ currentQuery: run, isRunning: true, currentOptimization: null })
  },

  startAttempt: (n) => set((s) => {
    if (!s.currentQuery) return s
    return { currentQuery: { ...s.currentQuery, attempts: [...s.currentQuery.attempts, { number: n, sql: '', status: 'generating' as const }] } }
  }),

  appendSQLChunk: (chunk, attempt) => set((s) => {
    if (!s.currentQuery) return s
    return { currentQuery: { ...s.currentQuery, attempts: s.currentQuery.attempts.map(a => a.number === attempt ? { ...a, sql: a.sql + chunk } : a) } }
  }),

  setAttemptStatus: (attempt, status) => set((s) => {
    if (!s.currentQuery) return s
    return { currentQuery: { ...s.currentQuery, attempts: s.currentQuery.attempts.map(a => a.number === attempt ? { ...a, status } : a) } }
  }),

  setAttemptError: (attempt, error) => set((s) => {
    if (!s.currentQuery) return s
    return { currentQuery: { ...s.currentQuery, attempts: s.currentQuery.attempts.map(a => a.number === attempt ? { ...a, error, status: 'error' as const } : a) } }
  }),

  appendDiagnosisChunk: (chunk, attempt) => set((s) => {
    if (!s.currentQuery) return s
    return { currentQuery: { ...s.currentQuery, attempts: s.currentQuery.attempts.map(a => a.number === attempt ? { ...a, diagnosis: (a.diagnosis ?? '') + chunk, status: 'diagnosing' as const } : a) } }
  }),

  finishQuery: (success, rows, rowCount, finalSQL) => set((s) => {
    if (!s.currentQuery) return { isRunning: false }
    const finished: QueryRun = { ...s.currentQuery, success, rows, rowCount, finalSQL }
    return { currentQuery: finished, queryHistory: [...s.queryHistory, finished], isRunning: false }
  }),

  setOptimizationStart: () => set({ currentOptimization: null }),

  setOptimizationDone: (reflection, newPrompt) => set((s) => ({
    currentPrompt: newPrompt,
    currentOptimization: { reflection, newPrompt },
    optimizations: [...s.optimizations, { generation: s.optimizations.length + 1, reflection, newPrompt, queryIndex: s.queryHistory.length }],
  })),

  setPlaygroundSQL: (s) => set({ playgroundSQL: s }),
  setPlaygroundResult: (r) => set({ playgroundResult: r }),
  setPlaygroundRunning: (b) => set({ playgroundRunning: b }),

  setSelectedTable: (t) => set({ selectedTable: t, tableBrowserPage: 0 }),
  setTableBrowserPage: (n) => set({ tableBrowserPage: n }),
}))
