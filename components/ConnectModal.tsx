'use client'

import { useState, useEffect } from 'react'
import { X, Trash2, Database, CheckCircle2, AlertCircle, Loader2 } from 'lucide-react'
import { useDemoStore } from '@/store/demo-store'
import type { DBType, DBConfig } from '@/lib/connector'
import type { SchemaGraph } from '@/lib/db'
import type { TableStat } from '@/store/demo-store'

// This matches the server-side StoredConnection shape (minus credentials)
interface SavedConnectionView {
  id: string
  name: string
  type: DBType
  filename?: string
  lastConnected?: number
  savedPrompt?: string
  // connectionString is NOT sent to the browser
}

const TYPE_LABELS: Record<DBType, string> = {
  sqlite: 'SQLite',
  postgresql: 'PostgreSQL',
  mysql: 'MySQL',
}

const TYPE_COLORS: Record<DBType, string> = {
  sqlite: 'bg-blue-500/20 text-blue-300 border-blue-500/30',
  postgresql: 'bg-cyan-500/20 text-cyan-300 border-cyan-500/30',
  mysql: 'bg-orange-500/20 text-orange-300 border-orange-500/30',
}

interface ConnectModalProps {
  onConnect: (schemaGraph: SchemaGraph, tables: TableStat[], config: DBConfig) => void
}

export function ConnectModal({ onConnect }: ConnectModalProps) {
  const { connectModalOpen, setConnectModalOpen, setConnectionStatus } = useDemoStore()

  const [saved, setSaved] = useState<SavedConnectionView[]>([])
  const [showNewForm, setShowNewForm] = useState(false)
  const [name, setName] = useState('')
  const [type, setType] = useState<DBType>('sqlite')
  const [connectionString, setConnectionString] = useState('')
  const [filename, setFilename] = useState('')
  const [testStatus, setTestStatus] = useState<null | 'testing' | 'ok' | 'error'>(null)
  const [testError, setTestError] = useState('')
  const [connecting, setConnecting] = useState<string | null>(null)
  const [connectError, setConnectError] = useState('')

  useEffect(() => {
    if (connectModalOpen) {
      // Load saved connections from server (credentials stay server-side)
      fetch('/api/connections')
        .then(r => r.json())
        .then((d: { connections: SavedConnectionView[] }) => {
          const list = d.connections ?? []
          // Always include benchmark DB
          if (!list.some(c => c.id === 'benchmark-db')) {
            list.unshift({ id: 'benchmark-db', name: 'Benchmark DB', type: 'sqlite' })
          }
          setSaved(list)
        })
        .catch(() => setSaved([{ id: 'benchmark-db', name: 'Benchmark DB', type: 'sqlite' }]))
      setShowNewForm(false)
      setTestStatus(null)
      setTestError('')
      setConnectError('')
    }
  }, [connectModalOpen])

  if (!connectModalOpen) return null

  async function handleConnectSaved(conn: SavedConnectionView) {
    setConnecting(conn.id)
    setConnectError('')
    setConnectionStatus('connecting')

    // Connect by ID — server looks up credentials
    const res = await fetch('/api/connect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ connectionId: conn.id }),
    })
    const data = (await res.json()) as { ok: boolean; error?: string; schemaGraph?: SchemaGraph; tables?: TableStat[] }

    if (!data.ok) {
      setConnectionStatus('error')
      setConnectError(data.error ?? 'Connection failed')
      setConnecting(null)
      return
    }

    setConnectionStatus('connected')
    onConnect(data.schemaGraph ?? { tables: [], edges: [] }, data.tables ?? [], { type: conn.type, name: conn.name })
    setConnectModalOpen(false)
    setConnecting(null)
  }

  async function handleTestNew() {
    setTestStatus('testing')
    setTestError('')
    const config: DBConfig = {
      type,
      name: name || 'Unnamed',
      connectionString: connectionString || undefined,
      filename: filename || undefined,
    }
    const res = await fetch('/api/connect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ config }),
    })
    const data = (await res.json()) as { ok: boolean; error?: string }
    if (data.ok) {
      await fetch('/api/disconnect', { method: 'POST' })
      setTestStatus('ok')
    } else {
      setTestStatus('error')
      setTestError(data.error ?? 'Failed')
    }
  }

  async function handleSaveAndConnect() {
    setConnecting('new')
    setConnectError('')
    setConnectionStatus('connecting')

    const config: DBConfig = {
      type,
      name: name || 'Unnamed',
      connectionString: connectionString || undefined,
      filename: filename || undefined,
    }

    // Connect first
    const res = await fetch('/api/connect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ config }),
    })
    const data = (await res.json()) as { ok: boolean; error?: string; schemaGraph?: SchemaGraph; tables?: TableStat[] }

    if (!data.ok) {
      setConnectionStatus('error')
      setConnectError(data.error ?? 'Connection failed')
      setConnecting(null)
      return
    }

    // Save credentials server-side (never stored in browser)
    await fetch('/api/connections', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: Date.now().toString(),
        name: name || 'Unnamed',
        type,
        connectionString: connectionString || undefined,
        filename: filename || undefined,
        lastConnected: Date.now(),
      }),
    })

    setConnectionStatus('connected')
    onConnect(data.schemaGraph ?? { tables: [], edges: [] }, data.tables ?? [], config)
    setConnectModalOpen(false)
    setConnecting(null)
  }

  async function handleDelete(id: string) {
    await fetch('/api/connections', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    })
    setSaved(saved.filter(s => s.id !== id))
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={e => { if (e.target === e.currentTarget) setConnectModalOpen(false) }}
    >
      <div className="bg-[#0d0d14] border border-white/10 rounded-2xl w-full max-w-lg mx-4 shadow-2xl shadow-black/50 flex flex-col max-h-[90vh] overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/[0.06] shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-violet-500 to-violet-700 flex items-center justify-center">
              <Database size={13} className="text-white" />
            </div>
            <h2 className="text-sm font-bold text-white">Connect to Database</h2>
          </div>
          <button onClick={() => setConnectModalOpen(false)} className="p-1.5 rounded-lg text-gray-500 hover:text-white hover:bg-white/10 transition-colors">
            <X size={14} />
          </button>
        </div>

        <div className="overflow-y-auto flex-1 p-5 flex flex-col gap-5">
          {connectError && (
            <div className="flex items-center gap-2 bg-red-500/10 border border-red-500/20 rounded-xl px-3 py-2.5 text-xs text-red-300">
              <AlertCircle size={13} className="shrink-0" /> {connectError}
            </div>
          )}

          {/* Saved connections */}
          {saved.length > 0 && (
            <section>
              <div className="text-[10px] font-semibold text-gray-500 uppercase tracking-widest mb-3">Saved Connections</div>
              <div className="flex flex-col gap-2">
                {saved.map(conn => (
                  <div key={conn.id} className="flex items-center justify-between bg-white/[0.03] border border-white/[0.06] rounded-xl px-3 py-2.5 hover:border-white/10 transition-colors">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-md border ${TYPE_COLORS[conn.type]}`}>
                        {TYPE_LABELS[conn.type]}
                      </span>
                      <span className="text-sm text-white truncate font-mono">{conn.name}</span>
                      {conn.savedPrompt && <span className="text-[9px] text-violet-400/60 shrink-0">GEPA tuned</span>}
                    </div>
                    <div className="flex items-center gap-1 shrink-0 ml-2">
                      <button
                        onClick={() => handleConnectSaved(conn)}
                        disabled={connecting !== null}
                        className="px-2.5 py-1 text-xs bg-violet-600/20 text-violet-300 border border-violet-500/30 rounded-lg hover:bg-violet-600/30 transition-colors disabled:opacity-50 flex items-center gap-1"
                      >
                        {connecting === conn.id && <Loader2 size={11} className="animate-spin" />}
                        Connect
                      </button>
                      {conn.id !== 'benchmark-db' && (
                        <button onClick={() => handleDelete(conn.id)} className="p-1.5 text-gray-600 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors">
                          <Trash2 size={12} />
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* New connection */}
          <section>
            <button
              onClick={() => setShowNewForm(!showNewForm)}
              className="flex items-center gap-2 text-[10px] font-semibold text-gray-500 uppercase tracking-widest mb-3 hover:text-gray-300 transition-colors"
            >
              <span className={`text-violet-400 text-sm leading-none ${showNewForm ? 'rotate-45' : ''} transition-transform inline-block`}>+</span>
              New Connection
            </button>

            {showNewForm && (
              <div className="flex flex-col gap-3">
                <div>
                  <label className="text-[10px] text-gray-500 font-medium mb-1 block">Connection Name</label>
                  <input type="text" value={name} onChange={e => setName(e.target.value)} placeholder="My Database"
                    className="w-full bg-white/[0.03] border border-white/[0.08] rounded-xl px-3 py-2 text-sm text-white placeholder-gray-600 font-mono focus:outline-none focus:border-violet-500/50 focus:bg-white/[0.05] transition-colors" />
                </div>

                <div>
                  <label className="text-[10px] text-gray-500 font-medium mb-1 block">Database Type</label>
                  <div className="flex gap-2">
                    {(['sqlite', 'postgresql', 'mysql'] as const).map(t => (
                      <button key={t} onClick={() => setType(t)}
                        className={`flex-1 py-2 text-xs font-semibold rounded-xl border transition-all ${type === t
                          ? 'bg-violet-600/20 text-violet-300 border-violet-500/40'
                          : 'text-gray-500 border-white/[0.06] hover:text-gray-300 hover:border-white/10'}`}>
                        {TYPE_LABELS[t]}
                      </button>
                    ))}
                  </div>
                </div>

                {type === 'sqlite' ? (
                  <div>
                    <label className="text-[10px] text-gray-500 font-medium mb-1 block">File Path</label>
                    <input type="text" value={filename} onChange={e => setFilename(e.target.value)} placeholder="/path/to/database.db"
                      className="w-full bg-white/[0.03] border border-white/[0.08] rounded-xl px-3 py-2 text-sm text-white placeholder-gray-600 font-mono focus:outline-none focus:border-violet-500/50 focus:bg-white/[0.05] transition-colors" />
                    <p className="text-[10px] text-gray-600 mt-1">Leave empty for demo benchmark DB</p>
                  </div>
                ) : (
                  <div>
                    <label className="text-[10px] text-gray-500 font-medium mb-1 block">Connection String</label>
                    <input type="password" value={connectionString} onChange={e => setConnectionString(e.target.value)}
                      placeholder={type === 'postgresql' ? 'postgresql://user:pass@host:5432/db' : 'mysql://user:pass@host:3306/db'}
                      className="w-full bg-white/[0.03] border border-white/[0.08] rounded-xl px-3 py-2 text-sm text-white placeholder-gray-600 font-mono focus:outline-none focus:border-violet-500/50 focus:bg-white/[0.05] transition-colors" />
                    <p className="text-[10px] text-gray-600 mt-1">Credentials are stored server-side only, never in the browser</p>
                  </div>
                )}

                {testStatus && (
                  <div className={`flex items-center gap-2 text-xs rounded-xl px-3 py-2 ${
                    testStatus === 'ok' ? 'bg-green-500/10 border border-green-500/20 text-green-300'
                    : testStatus === 'error' ? 'bg-red-500/10 border border-red-500/20 text-red-300'
                    : 'bg-white/[0.03] border border-white/[0.06] text-gray-400'}`}>
                    {testStatus === 'testing' && <Loader2 size={12} className="animate-spin" />}
                    {testStatus === 'ok' && <CheckCircle2 size={12} />}
                    {testStatus === 'error' && <AlertCircle size={12} />}
                    {testStatus === 'testing' ? 'Testing...' : testStatus === 'ok' ? 'Connection successful' : testError}
                  </div>
                )}

                <div className="flex gap-2 pt-1">
                  <button onClick={handleTestNew} disabled={testStatus === 'testing' || connecting === 'new'}
                    className="flex-1 py-2 text-xs font-semibold bg-white/[0.04] text-gray-300 border border-white/[0.08] rounded-xl hover:bg-white/[0.07] transition-colors disabled:opacity-50 flex items-center justify-center gap-1.5">
                    {testStatus === 'testing' && <Loader2 size={11} className="animate-spin" />}
                    Test
                  </button>
                  <button onClick={handleSaveAndConnect} disabled={connecting === 'new' || testStatus === 'testing'}
                    className="flex-1 py-2 text-xs font-semibold bg-violet-600/30 text-violet-200 border border-violet-500/40 rounded-xl hover:bg-violet-600/40 transition-colors disabled:opacity-50 flex items-center justify-center gap-1.5">
                    {connecting === 'new' && <Loader2 size={11} className="animate-spin" />}
                    Save &amp; Connect
                  </button>
                </div>
              </div>
            )}
          </section>
        </div>

        <div className="px-5 py-3 border-t border-white/[0.06] shrink-0">
          <button onClick={() => setConnectModalOpen(false)} className="w-full py-2 text-xs font-semibold text-gray-500 hover:text-gray-300 transition-colors">
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}
