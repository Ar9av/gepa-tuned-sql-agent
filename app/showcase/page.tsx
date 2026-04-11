'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { ConnectModal } from '@/components/ConnectModal'
import { useDemoStore } from '@/store/demo-store'
import type { SchemaGraph } from '@/lib/db'
import type { DBConfig } from '@/lib/connector'
import type { TableStat } from '@/store/demo-store'

// ─── Prompt generations ───────────────────────────────────────────────────────

const PROMPTS: Record<number, string> = {
  0: `You are a SQL expert. Given a natural language question and a database schema, write a correct SQL query.

Rules:
- Output ONLY the SQL query, nothing else
- No markdown, no code fences, no explanation
- Use correct SQL syntax`,

  1: `You are a SQL expert. Given a natural language question and a database schema, write a correct SQL query.

Rules:
- Output ONLY the SQL query, nothing else
- No markdown, no code fences, no explanation
- Use correct SQL syntax
- Always qualify column names with table aliases to avoid ambiguity
- For revenue, multiply order_items.quantity × order_items.unit_price — never assume a single price/amount column
- Verify every foreign key against the schema before writing any JOIN`,

  2: `You are a SQL expert. Given a natural language question and a database schema, write a correct SQL query.

Rules:
- Output ONLY the SQL query, nothing else
- No markdown, no code fences, no explanation
- Use correct SQL syntax
- Always qualify column names with table aliases to avoid ambiguity
- For revenue, multiply order_items.quantity × order_items.unit_price — never assume a single price/amount column
- Verify every foreign key against the schema before writing any JOIN
- For time-series: strftime('%Y-%m', col) for months, strftime('%Y', col) for years
- For top-N always use ORDER BY … DESC LIMIT N
- Do not filter WHERE on date when asked for "last N months" — group then LIMIT instead`,
}

const SCORES = [0.50, 0.78, 0.92]

// ─── Types ────────────────────────────────────────────────────────────────────

type DiffLine = { kind: 'same' | 'add'; text: string }

interface BubbleData {
  id: number
  type: 'user' | 'thinking' | 'sql_attempt' | 'sql_ok' | 'sql_err' | 'failed' | 'gepa_diff'
  text?: string
  sql?: string
  rows?: Record<string, string | number>[]
  attempt?: number
  badge?: string
  thoughts?: string[]
  diff?: { from: number; to: number; lines: DiffLine[] }
}

type Attempt =
  | { sql: string; error: string; thoughts: string[] }
  | { sql: string; success: true; rows: Record<string, string | number>[]; thoughts: string[] }

interface QueryDef {
  id: string
  label: string
  q: string
  badge?: string
  attempts: Attempt[]
  failed?: true
}

// ─── Query library ────────────────────────────────────────────────────────────

const QUERIES: Record<string, QueryDef> = {
  revenue_1: {
    id: 'revenue_1', label: 'Revenue by category',
    q: 'Show me total revenue by product category',
    attempts: [
      {
        sql: 'SELECT category, SUM(price) AS revenue\nFROM orders\nGROUP BY category\nORDER BY revenue DESC',
        error: 'no such column: category',
        thoughts: [
          'Need to group by product category',
          'Assuming "category" column exists on orders — will try',
          'Revenue ≈ SUM(price) from orders table',
        ],
      },
      {
        sql: 'SELECT c.name AS category,\n       SUM(oi.quantity * oi.unit_price) AS revenue\nFROM   order_items oi\nJOIN   products   p  ON oi.product_id  = p.id\nJOIN   categories c  ON p.category_id  = c.id\nGROUP  BY c.name\nORDER  BY revenue DESC',
        success: true,
        rows: [
          { category: 'Electronics',   revenue: 142850 },
          { category: 'Clothing',      revenue:  98430 },
          { category: 'Home & Garden', revenue:  76210 },
          { category: 'Sports',        revenue:  54890 },
          { category: 'Books',         revenue:  31200 },
        ],
        thoughts: [
          '"category" is in the categories table, not orders',
          'Revenue = order_items.quantity × order_items.unit_price',
          'Join path: order_items → products → categories',
        ],
      },
    ],
  },

  customers_1: {
    id: 'customers_1', label: 'Top 5 customers by LTV',
    q: 'Who are the top 5 customers by lifetime value?',
    failed: true,
    attempts: [
      {
        sql: 'SELECT id, name, SUM(total) AS ltv\nFROM customers JOIN orders ON id = customer_id\nGROUP BY id ORDER BY ltv DESC LIMIT 5',
        error: 'ambiguous column name: id',
        thoughts: [
          'Lifetime value = total spend across all orders',
          'Join customers → orders on customer_id',
          'Assuming "total" column on orders for order value',
        ],
      },
      {
        sql: 'SELECT c.id, c.name, SUM(o.total_amount) AS ltv\nFROM customers c\nJOIN orders o ON c.id = o.customer_id\nGROUP BY c.id ORDER BY ltv DESC LIMIT 5',
        error: 'no such column: o.total_amount',
        thoughts: [
          'Fixed ambiguous id with table alias c.id',
          'Trying o.total_amount as the order total column',
        ],
      },
      {
        sql: 'SELECT c.id, c.name,\n       SUM(oi.quantity * oi.unit_price) AS ltv\nFROM customers c\nJOIN orders o      ON c.id = o.customer_id\nJOIN order_items   ON o.id = order_id\nGROUP BY c.id ORDER BY ltv DESC LIMIT 5',
        error: 'ambiguous column name: order_id',
        thoughts: [
          'No total_amount column — computing from order_items',
          'Must join through order_items to get line items',
          'Need to alias order_items to qualify order_id',
        ],
      },
    ],
  },

  monthly_1: {
    id: 'monthly_1', label: 'Monthly revenue trend',
    q: 'Monthly revenue trend — last 6 months',
    failed: true,
    attempts: [
      {
        sql: "SELECT strftime('%Y-%m', created_at) AS month,\n       SUM(amount) AS revenue\nFROM orders\nWHERE created_at >= date('now','-6 months')\nGROUP BY month ORDER BY month",
        error: 'no such column: amount',
        thoughts: [
          'Time series: group by month using strftime',
          'Filter last 6 months with date arithmetic',
          'Assuming "amount" column on orders',
        ],
      },
      {
        sql: "SELECT strftime('%Y-%m', o.created_at) AS month,\n       SUM(oi.quantity * oi.unit_price) AS revenue\nFROM orders o JOIN order_items oi ON o.id = oi.order_id\nWHERE o.created_at >= date('now','-6 months')\nGROUP BY month ORDER BY month",
        error: 'query returned 0 rows — date filter too restrictive',
        thoughts: [
          'Fixed: revenue from order_items.quantity × unit_price',
          'WHERE date filter may cut all rows from sample data',
          'Retrying without the date restriction',
        ],
      },
    ],
  },

  revenue_2: {
    id: 'revenue_2', label: 'Revenue by category',
    q: 'Show me total revenue by product category',
    badge: '✓ first try',
    attempts: [
      {
        sql: 'SELECT c.name AS category,\n       SUM(oi.quantity * oi.unit_price) AS revenue\nFROM   order_items oi\nJOIN   products   p  ON oi.product_id  = p.id\nJOIN   categories c  ON p.category_id  = c.id\nGROUP  BY c.name\nORDER  BY revenue DESC',
        success: true,
        rows: [
          { category: 'Electronics',   revenue: 142850 },
          { category: 'Clothing',      revenue:  98430 },
          { category: 'Home & Garden', revenue:  76210 },
          { category: 'Sports',        revenue:  54890 },
          { category: 'Books',         revenue:  31200 },
        ],
        thoughts: [
          'Revenue from order_items.quantity × unit_price',
          'Join path: order_items → products → categories',
          'Qualify all column names with table aliases',
        ],
      },
    ],
  },

  customers_2: {
    id: 'customers_2', label: 'Top 5 customers by LTV',
    q: 'Who are the top 5 customers by lifetime value?',
    badge: '✓ first try',
    attempts: [
      {
        sql: 'SELECT c.id, c.name,\n       SUM(oi.quantity * oi.unit_price) AS lifetime_value\nFROM customers   c\nJOIN orders      o  ON c.id = o.customer_id\nJOIN order_items oi ON o.id = oi.order_id\nGROUP BY c.id, c.name\nORDER BY lifetime_value DESC\nLIMIT 5',
        success: true,
        rows: [
          { id: 1042, name: 'Acme Corp',       lifetime_value: 28400 },
          { id:  891, name: 'Jane Smith',      lifetime_value: 19750 },
          { id:  334, name: 'TechStart Inc',   lifetime_value: 17200 },
          { id: 1205, name: 'Bob Johnson',     lifetime_value: 14980 },
          { id:  678, name: 'Global Trade Co', lifetime_value: 12650 },
        ],
        thoughts: [
          'Alias all tables to avoid ambiguity',
          'LTV = SUM(quantity × unit_price) across all order_items',
          'Three-table join: customers → orders → order_items',
        ],
      },
    ],
  },

  monthly_2: {
    id: 'monthly_2', label: 'Monthly revenue trend',
    q: 'Monthly revenue trend — last 6 months',
    badge: '✓ first try',
    attempts: [
      {
        sql: "SELECT strftime('%Y-%m', o.created_at) AS month,\n       SUM(oi.quantity * oi.unit_price) AS revenue\nFROM orders o\nJOIN order_items oi ON o.id = oi.order_id\nGROUP BY month\nORDER BY month DESC\nLIMIT 6",
        success: true,
        rows: [
          { month: '2025-12', revenue: 52300 },
          { month: '2025-11', revenue: 48750 },
          { month: '2025-10', revenue: 61200 },
          { month: '2025-09', revenue: 44100 },
          { month: '2025-08', revenue: 39800 },
          { month: '2025-07', revenue: 55600 },
        ],
        thoughts: [
          'Time series: strftime("%Y-%m", ...) for month grouping',
          'Revenue from order_items, not a single column',
          'Group then LIMIT 6 instead of filtering by date',
        ],
      },
    ],
  },
}

// Rounds drive the interactive flow
const ROUND_1 = ['revenue_1', 'customers_1', 'monthly_1']
const ROUND_2 = ['revenue_2', 'customers_2', 'monthly_2']

// ─── Helpers ──────────────────────────────────────────────────────────────────

function diffPrompts(from: number, to: number): DiffLine[] {
  const prevSet = new Set(PROMPTS[from].split('\n'))
  return PROMPTS[to].split('\n').map(text => ({
    kind: prevSet.has(text) ? 'same' : 'add',
    text,
  }))
}

function scoreColor(s: number) {
  if (s > 0.82) return '#4ade80'
  if (s > 0.66) return '#facc15'
  return '#f87171'
}

// ─── ER Diagram ───────────────────────────────────────────────────────────────

function ERDModal({ onClose, dark }: { onClose: () => void; dark: boolean }) {
  const bg  = dark ? '#07070e' : '#f8f9fc'
  const bg2 = dark ? '#0d0d1a' : '#ffffff'
  const br  = dark ? '#ffffff18' : '#00000012'
  const tx  = dark ? '#e2e8f0'  : '#1e293b'
  const mu  = dark ? '#64748b'  : '#94a3b8'
  const pk  = dark ? '#a78bfa'  : '#7c3aed'
  const fk  = dark ? '#60a5fa'  : '#2563eb'

  const tables = [
    {
      name: 'categories', x: 20, y: 80,
      cols: [
        { name: 'id',        note: 'PK', type: 'INTEGER' },
        { name: 'name',      note: '',   type: 'TEXT'    },
        { name: 'parent_id', note: '',   type: 'INTEGER' },
      ],
    },
    {
      name: 'products', x: 195, y: 50,
      cols: [
        { name: 'id',          note: 'PK', type: 'INTEGER' },
        { name: 'name',        note: '',   type: 'TEXT'    },
        { name: 'category_id', note: 'FK', type: 'INTEGER' },
        { name: 'sku',         note: '',   type: 'TEXT'    },
        { name: 'description', note: '',   type: 'TEXT'    },
      ],
    },
    {
      name: 'order_items', x: 390, y: 30,
      cols: [
        { name: 'id',         note: 'PK', type: 'INTEGER' },
        { name: 'order_id',   note: 'FK', type: 'INTEGER' },
        { name: 'product_id', note: 'FK', type: 'INTEGER' },
        { name: 'quantity',   note: '',   type: 'INTEGER' },
        { name: 'unit_price', note: '',   type: 'REAL'    },
      ],
    },
    {
      name: 'orders', x: 585, y: 60,
      cols: [
        { name: 'id',          note: 'PK', type: 'INTEGER' },
        { name: 'customer_id', note: 'FK', type: 'INTEGER' },
        { name: 'status',      note: '',   type: 'TEXT'    },
        { name: 'created_at',  note: '',   type: 'TEXT'    },
      ],
    },
    {
      name: 'customers', x: 760, y: 90,
      cols: [
        { name: 'id',         note: 'PK', type: 'INTEGER' },
        { name: 'name',       note: '',   type: 'TEXT'    },
        { name: 'email',      note: '',   type: 'TEXT'    },
        { name: 'city',       note: '',   type: 'TEXT'    },
        { name: 'created_at', note: '',   type: 'TEXT'    },
      ],
    },
  ]

  const BOX_W = 150
  const ROW_H = 20
  const HDR_H = 26

  function boxHeight(t: typeof tables[0]) { return HDR_H + t.cols.length * ROW_H + 8 }
  function boxCentreY(t: typeof tables[0]) { return t.y + boxHeight(t) / 2 }
  function boxRight(t: typeof tables[0]) { return t.x + BOX_W }

  // Connections: [from_idx, to_idx, label]
  const edges: [number, number, string][] = [
    [0, 1, '1:N'],
    [1, 2, '1:N'],
    [3, 2, '1:N'],
    [4, 3, '1:N'],
  ]

  const svgH = 310

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)' }}>
      <div className="rounded-2xl border overflow-hidden w-full max-w-5xl" style={{ background: bg, borderColor: br }}>
        <div className="flex items-center justify-between px-5 py-3 border-b" style={{ borderColor: br }}>
          <div>
            <h2 className="text-sm font-bold" style={{ color: tx }}>ER Diagram — ecommerce.db</h2>
            <p className="text-[10px] mt-0.5" style={{ color: mu }}>5 tables · SQLite · sample dataset</p>
          </div>
          <button onClick={onClose} className="w-7 h-7 rounded-lg flex items-center justify-center text-lg hover:opacity-70 transition-opacity" style={{ color: mu }}>×</button>
        </div>

        <div className="overflow-x-auto p-4">
          <svg width={960} height={svgH} viewBox={`0 0 960 ${svgH}`} className="w-full">
            <defs>
              <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto">
                <path d="M 0 0 L 10 5 L 0 10 z" fill={mu} />
              </marker>
            </defs>

            {/* Edges */}
            {edges.map(([fi, ti, label], i) => {
              const from = tables[fi]
              const to   = tables[ti]
              const x1   = boxRight(from)
              const y1   = boxCentreY(from)
              const x2   = to.x
              const y2   = boxCentreY(to)
              const mx   = (x1 + x2) / 2
              return (
                <g key={i}>
                  <path d={`M ${x1} ${y1} C ${mx} ${y1} ${mx} ${y2} ${x2} ${y2}`}
                    fill="none" stroke={mu} strokeWidth="1.5" markerEnd="url(#arrow)" strokeDasharray="4 2" />
                  <rect x={mx - 12} y={(y1 + y2) / 2 - 9} width={24} height={16} rx={4} fill={bg2} stroke={br} strokeWidth={1} />
                  <text x={mx} y={(y1 + y2) / 2 + 2} textAnchor="middle" fontSize={8} fill={mu}>{label}</text>
                </g>
              )
            })}

            {/* Tables */}
            {tables.map((t, ti) => {
              const h = boxHeight(t)
              return (
                <g key={ti}>
                  <rect x={t.x} y={t.y} width={BOX_W} height={h} rx={8} fill={bg2} stroke={br} strokeWidth={1.5} />
                  <rect x={t.x} y={t.y} width={BOX_W} height={HDR_H} rx={8} fill={pk + '22'} />
                  <rect x={t.x} y={t.y + HDR_H - 4} width={BOX_W} height={4} fill={pk + '22'} />
                  <text x={t.x + BOX_W / 2} y={t.y + 17} textAnchor="middle" fontSize={11} fontWeight="700" fill={pk}>{t.name}</text>
                  {t.cols.map((col, ci) => {
                    const cy = t.y + HDR_H + 6 + ci * ROW_H + 12
                    return (
                      <g key={ci}>
                        <text x={t.x + 8} y={cy} fontSize={9} fill={col.note === 'PK' ? pk : col.note === 'FK' ? fk : tx}>
                          {col.note ? <tspan fontWeight="700">[{col.note}] </tspan> : null}{col.name}
                        </text>
                        <text x={t.x + BOX_W - 8} y={cy} textAnchor="end" fontSize={8} fill={mu}>{col.type}</text>
                      </g>
                    )
                  })}
                </g>
              )
            })}
          </svg>
        </div>

        <div className="px-5 py-3 border-t flex items-center gap-4 text-[10px]" style={{ borderColor: br, color: mu }}>
          <span><span style={{ color: pk }}>■</span> Primary key</span>
          <span><span style={{ color: fk }}>■</span> Foreign key</span>
          <span>----→ One-to-many relationship</span>
          <span className="ml-auto">Revenue = order_items.quantity × order_items.unit_price</span>
        </div>
      </div>
    </div>
  )
}

// ─── GitHub-style inline diff ─────────────────────────────────────────────────

function InlineDiff({ from, to, lines, dark }: { from: number; to: number; lines: DiffLine[]; dark: boolean }) {
  const [expanded, setExpanded] = useState(false)
  const added = lines.filter(l => l.kind === 'add').length
  const bg    = dark ? '#0a0a16' : '#f8f9fc'
  const hdr   = dark ? '#13132a' : '#eef2ff'
  const br    = dark ? '#ffffff18' : '#6366f120'
  const same  = dark ? '#6b7280'  : '#9ca3af'
  const addBg = dark ? '#14532d30' : '#dcfce7'
  const addTx = dark ? '#4ade80'   : '#166534'
  const addMk = dark ? '#22c55e'   : '#16a34a'
  const mu    = dark ? '#818cf8'   : '#6366f1'

  return (
    <div className="rounded-xl overflow-hidden border text-[10px] font-mono" style={{ background: bg, borderColor: br }}>
      <div
        className="flex items-center justify-between px-3 py-2 cursor-pointer select-none"
        style={{ background: hdr }}
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-2">
          <span style={{ color: mu }}>⚡</span>
          <span className="font-semibold" style={{ color: mu }}>system_prompt.txt</span>
          <span className="opacity-60" style={{ color: mu }}>Gen {from} → Gen {to}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="px-1.5 py-0.5 rounded text-[9px] font-bold" style={{ background: addBg, color: addTx }}>
            +{added} rules
          </span>
          <span style={{ color: mu }}>{expanded ? '▲' : '▼'}</span>
        </div>
      </div>

      {expanded && (
        <div className="overflow-x-auto max-h-56 overflow-y-auto">
          {lines.map((line, i) => (
            <div
              key={i}
              className="flex gap-2 px-3 py-px leading-5"
              style={{ background: line.kind === 'add' ? addBg : undefined }}
            >
              <span className="select-none w-3 shrink-0" style={{ color: line.kind === 'add' ? addMk : 'transparent' }}>
                {line.kind === 'add' ? '+' : ' '}
              </span>
              <span style={{ color: line.kind === 'add' ? addTx : same }}>
                {line.text || '\u00a0'}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Bubble components ────────────────────────────────────────────────────────

function Bubble({ b, dark }: { b: BubbleData; dark: boolean }) {
  const tx   = dark ? '#f1f5f9' : '#0f172a'
  const mu   = dark ? '#64748b' : '#94a3b8'
  const card = dark ? 'rgba(255,255,255,0.025)' : '#ffffff'
  const br   = dark ? 'rgba(255,255,255,0.07)'  : 'rgba(0,0,0,0.08)'

  if (b.type === 'user') return (
    <div className="flex justify-end">
      <div className="rounded-2xl rounded-br-sm px-4 py-2.5 max-w-[86%]"
        style={{ background: 'rgba(124,58,237,0.18)', border: '1px solid rgba(124,58,237,0.35)' }}>
        <p className="text-sm font-medium" style={{ color: tx }}>{b.text}</p>
      </div>
    </div>
  )

  if (b.type === 'thinking') return (
    <div className="rounded-xl p-3" style={{ background: card, border: `1px solid ${br}` }}>
      <div className="flex items-center gap-1.5 mb-2" style={{ color: mu }}>
        <span className="text-[10px] font-mono">Reasoning</span>
        <span className="flex gap-0.5">
          {[0, 150, 300].map(d => (
            <span key={d} className="w-1 h-1 rounded-full bg-violet-400" style={{ animation: `pulse 1.2s ${d}ms infinite` }} />
          ))}
        </span>
      </div>
      <div className="space-y-1">
        {(b.thoughts ?? []).map((t, i) => (
          <div key={i} className="flex items-start gap-1.5 text-[11px]" style={{ color: mu }}>
            <span className="mt-0.5 shrink-0">•</span>
            <span>{t}</span>
          </div>
        ))}
      </div>
    </div>
  )

  if (b.type === 'sql_attempt') return (
    <div className="rounded-xl p-3" style={{ background: card, border: `1px solid ${br}` }}>
      <div className="flex items-center gap-1.5 mb-1.5" style={{ color: mu }}>
        <span className="w-1.5 h-1.5 rounded-full bg-violet-500" style={{ animation: 'pulse 1s infinite' }} />
        <span className="text-[10px] font-mono">Attempt {b.attempt} — Generating SQL…</span>
      </div>
      <pre className="text-[11px] font-mono whitespace-pre overflow-x-auto leading-relaxed" style={{ color: dark ? '#d1d5db' : '#374151' }}>
        {b.sql}<span style={{ animation: 'pulse 0.8s infinite', color: mu }}>▋</span>
      </pre>
    </div>
  )

  if (b.type === 'sql_err') return (
    <div className="space-y-1.5">
      <div className="rounded-xl p-3" style={{ background: card, border: `1px solid ${br}` }}>
        <div className="text-[10px] mb-1.5 font-mono" style={{ color: mu }}>Attempt {b.attempt}</div>
        <pre className="text-[11px] font-mono whitespace-pre overflow-x-auto leading-relaxed" style={{ color: dark ? '#9ca3af' : '#6b7280' }}>{b.sql}</pre>
      </div>
      <div className="flex items-start gap-2 text-[11px] rounded-xl px-3 py-2 font-mono"
        style={{ color: '#f87171', background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.18)' }}>
        <span className="shrink-0 mt-px">✗</span><span>{b.text}</span>
      </div>
    </div>
  )

  if (b.type === 'sql_ok') {
    const cols = b.rows && b.rows.length > 0 ? Object.keys(b.rows[0]) : []
    return (
      <div className="space-y-2">
        <div className="rounded-xl p-3" style={{ background: card, border: `1px solid ${br}` }}>
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[10px] font-mono" style={{ color: mu }}>Attempt {b.attempt}</span>
            {b.badge && (
              <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded"
                style={{ color: '#4ade80', background: 'rgba(74,222,128,0.1)', border: '1px solid rgba(74,222,128,0.25)' }}>
                {b.badge}
              </span>
            )}
          </div>
          <pre className="text-[11px] font-mono whitespace-pre overflow-x-auto leading-relaxed" style={{ color: '#4ade80' }}>{b.sql}</pre>
        </div>
        {cols.length > 0 && b.rows && (
          <div className="rounded-xl overflow-hidden" style={{ background: card, border: `1px solid ${br}` }}>
            <table className="w-full text-xs font-mono">
              <thead>
                <tr style={{ borderBottom: `1px solid ${br}` }}>
                  {cols.map(k => <th key={k} className="px-3 py-1.5 text-left font-normal" style={{ color: mu }}>{k}</th>)}
                </tr>
              </thead>
              <tbody>
                {b.rows.map((row, ri) => (
                  <tr key={ri} style={{ borderBottom: `1px solid ${br}` }}>
                    {cols.map(k => (
                      <td key={k} className="px-3 py-1.5" style={{ color: dark ? '#d1d5db' : '#374151' }}>
                        {typeof row[k] === 'number' && String(row[k]).length >= 4
                          ? (row[k] as number).toLocaleString()
                          : String(row[k])}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    )
  }

  if (b.type === 'failed') return (
    <div className="flex items-center gap-2 text-xs rounded-xl px-3 py-2.5 font-medium"
      style={{ color: '#fca5a5', background: 'rgba(239,68,68,0.07)', border: '1px solid rgba(239,68,68,0.2)' }}>
      <span>❌</span><span>{b.text}</span>
    </div>
  )

  if (b.type === 'gepa_diff' && b.diff) return (
    <InlineDiff from={b.diff.from} to={b.diff.to} lines={b.diff.lines} dark={dark} />
  )

  return null
}

// ─── End summary ──────────────────────────────────────────────────────────────

function EndSummary({ dark, onConnect }: { dark: boolean; onConnect: () => void }) {
  const tx  = dark ? '#f1f5f9' : '#0f172a'
  const mu  = dark ? '#64748b' : '#94a3b8'
  const br  = dark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.08)'
  const bg  = dark ? 'rgba(255,255,255,0.02)' : '#ffffff'

  const allDiff = diffPrompts(0, 2)
  const added   = allDiff.filter(l => l.kind === 'add')

  return (
    <div className="space-y-4 mt-2">
      <div className="rounded-xl p-4" style={{ background: 'rgba(124,58,237,0.08)', border: '1px solid rgba(124,58,237,0.25)' }}>
        <p className="text-sm font-bold mb-1" style={{ color: '#a78bfa' }}>✅ Demo complete</p>
        <p className="text-xs" style={{ color: mu }}>
          The agent ran 6 queries across 2 optimization cycles. Score improved from 50% to 92%.
        </p>
        <div className="flex items-center gap-3 mt-3 text-xs font-mono font-bold">
          <span style={{ color: scoreColor(0.50) }}>50%</span>
          <span style={{ color: mu }}>→</span>
          <span style={{ color: scoreColor(0.78) }}>78%</span>
          <span style={{ color: mu }}>→</span>
          <span style={{ color: scoreColor(0.92) }}>92%</span>
        </div>
      </div>

      <div className="rounded-xl overflow-hidden" style={{ background: bg, border: `1px solid ${br}` }}>
        <div className="px-4 py-2.5 border-b flex items-center justify-between" style={{ borderColor: br }}>
          <span className="text-[11px] font-mono font-semibold" style={{ color: '#818cf8' }}>system_prompt.txt — Gen 0 → Gen 2</span>
          <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ color: '#4ade80', background: 'rgba(74,222,128,0.1)', border: '1px solid rgba(74,222,128,0.2)' }}>
            +{added.length} rules learned
          </span>
        </div>
        <div className="font-mono text-[10px] max-h-56 overflow-y-auto">
          {allDiff.map((line, i) => (
            <div
              key={i}
              className="flex gap-2 px-4 py-px leading-5"
              style={{ background: line.kind === 'add' ? (dark ? '#14532d30' : '#dcfce7') : undefined }}
            >
              <span className="select-none w-3 shrink-0"
                style={{ color: line.kind === 'add' ? (dark ? '#22c55e' : '#16a34a') : 'transparent' }}>
                {line.kind === 'add' ? '+' : ' '}
              </span>
              <span style={{ color: line.kind === 'add' ? (dark ? '#4ade80' : '#166534') : (dark ? '#6b7280' : '#9ca3af') }}>
                {line.text || '\u00a0'}
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-xl p-4" style={{ background: bg, border: `1px solid ${br}` }}>
        <p className="text-xs font-semibold mb-1" style={{ color: tx }}>Try it with your own database</p>
        <p className="text-[11px] mb-3" style={{ color: mu }}>
          Connect PostgreSQL, MySQL, or SQLite — the agent and GEPA optimizer work on any schema.
        </p>
        <button
          onClick={onConnect}
          className="text-xs font-semibold px-4 py-2 rounded-lg transition-opacity hover:opacity-80"
          style={{ background: 'rgba(124,58,237,0.2)', border: '1px solid rgba(124,58,237,0.4)', color: '#a78bfa' }}
        >
          Connect database →
        </button>
      </div>
    </div>
  )
}


// ─── Prompt panel ─────────────────────────────────────────────────────────────

function PromptPanel({ gen, score, history, diffLines, dark }: {
  gen: number; score: number; history: number[]; diffLines: DiffLine[]; dark: boolean
}) {
  const tx  = dark ? '#f1f5f9' : '#0f172a'
  const mu  = dark ? '#64748b' : '#94a3b8'
  const br  = dark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.08)'
  const bg  = dark ? 'rgba(255,255,255,0.02)'  : '#ffffff'

  const W = 220; const H = 52
  const pts = history.length < 2 ? null : history.map((s, i) => {
    const x = (i / (history.length - 1)) * W
    const y = H - s * H
    return `${x.toFixed(1)},${y.toFixed(1)}`
  })

  return (
    <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
      {/* Score */}
      <div>
        <div className="flex justify-between text-[10px] mb-1.5">
          <span style={{ color: mu }}>Benchmark score</span>
          <span className="font-mono font-bold" style={{ color: scoreColor(score) }}>
            {(score * 100).toFixed(1)}%
          </span>
        </div>
        <div className="h-1.5 rounded-full overflow-hidden" style={{ background: dark ? 'rgba(255,255,255,0.06)' : '#e2e8f0' }}>
          <div className="h-full rounded-full transition-all duration-75" style={{ width: `${score * 100}%`, backgroundColor: scoreColor(score) }} />
        </div>
        {gen > 0 && (
          <p className="text-[10px] mt-1" style={{ color: '#4ade80' }}>
            +{((SCORES[gen] - SCORES[0]) * 100).toFixed(0)}pp vs baseline
          </p>
        )}
      </div>

      {/* Chart */}
      {pts && (
        <div>
          <p className="text-[10px] mb-1" style={{ color: mu }}>Score history</p>
          <svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="w-full">
            <defs>
              <linearGradient id="sg" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#a78bfa" stopOpacity="0.4" />
                <stop offset="100%" stopColor="#a78bfa" stopOpacity="0" />
              </linearGradient>
            </defs>
            <polygon points={`${pts.join(' ')} ${W},${H} 0,${H}`} fill="url(#sg)" />
            <polyline points={pts.join(' ')} fill="none" stroke="#a78bfa" strokeWidth="2" strokeLinejoin="round" />
            {history.map((s, i) => (
              <circle key={i} cx={(i / (history.length - 1)) * W} cy={H - s * H} r="3.5" fill="#a78bfa" />
            ))}
          </svg>
        </div>
      )}

      {/* Gen */}
      <div className="flex items-center gap-2">
        <span className="text-[10px]" style={{ color: mu }}>Generation</span>
        <span className="text-[11px] font-mono font-bold px-2 py-0.5 rounded"
          style={{ color: '#a78bfa', background: 'rgba(167,139,250,0.1)', border: '1px solid rgba(167,139,250,0.25)' }}>
          {gen}
        </span>
      </div>

      {/* Prompt */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-[10px]" style={{ color: mu }}>Current system prompt</span>
          {diffLines.some(l => l.kind === 'add') && (
            <span className="text-[9px] px-1.5 py-0.5 rounded"
              style={{ color: '#4ade80', background: 'rgba(74,222,128,0.08)', border: '1px solid rgba(74,222,128,0.2)' }}>
              +{diffLines.filter(l => l.kind === 'add').length} rules
            </span>
          )}
        </div>
        <div className="rounded-lg p-2.5 text-[10px] font-mono max-h-72 overflow-y-auto overflow-x-auto space-y-px"
          style={{ background: bg, border: `1px solid ${br}` }}>
          {diffLines.map((line, i) => (
            <div
              key={i}
              className="flex gap-1.5 px-1 rounded leading-5"
              style={{ background: line.kind === 'add' ? (dark ? 'rgba(74,222,128,0.1)' : '#dcfce7') : undefined }}
            >
              {line.kind === 'add' && <span className="shrink-0" style={{ color: dark ? '#22c55e' : '#16a34a' }}>+</span>}
              <span style={{ color: line.kind === 'add' ? (dark ? '#4ade80' : '#166534') : (dark ? '#6b7280' : '#9ca3af') }}>
                {line.text || '\u00a0'}
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className="text-[10px] space-y-1 pt-1 border-t" style={{ borderColor: br, color: mu }}>
        <div className="flex items-center gap-1.5"><span style={{ color: '#4ade80' }}>+</span><span>Rule learned from failures</span></div>
        <div className="flex items-center gap-1.5"><span style={{ color: mu }}>·</span><span>Unchanged rule</span></div>
      </div>
    </div>
  )
}

// ─── Main page ─────────────────────────────────────────────────────────────────

type AppState = 'idle' | 'running' | 'gepa' | 'done'
type Round = 1 | 2 | 'end'

export default function ShowcasePage() {
  const [dark, setDark]             = useState(true)
  const [bubbles, setBubbles]       = useState<BubbleData[]>([])
  const [appState, setAppState]     = useState<AppState>('idle')
  const [round, setRound]           = useState<Round>(1)
  const [doneSets, setDoneSets]     = useState<{ r1: Set<string>; r2: Set<string> }>({ r1: new Set(), r2: new Set() })
  const [gen, setGen]               = useState(0)
  const [score, setScore]           = useState(SCORES[0])
  const [scoreHist, setScoreHist]   = useState<number[]>([SCORES[0]])
  const [diffLines, setDiffLines]   = useState<DiffLine[]>(PROMPTS[0].split('\n').map(t => ({ kind: 'same' as const, text: t })))
  const [showER, setShowER]         = useState(false)
  const [started, setStarted]       = useState(false)

  const { setConnectModalOpen } = useDemoStore()

  const cancel = useRef(false)
  const idRef  = useRef(0)
  const endRef = useRef<HTMLDivElement>(null)

  function uid() { return ++idRef.current }

  function sleep(ms: number) {
    return new Promise<void>((res, rej) => {
      const t = setTimeout(() => cancel.current ? rej() : res(), ms)
      return () => clearTimeout(t)
    })
  }

  function push(b: Omit<BubbleData, 'id'>) {
    setBubbles(prev => [...prev, { ...b, id: uid() }])
  }

  function replaceLast(update: Partial<BubbleData>) {
    setBubbles(prev => {
      if (!prev.length) return prev
      const last = prev[prev.length - 1]
      return [...prev.slice(0, -1), { ...last, ...update }]
    })
  }

  async function typeUser(text: string) {
    // Push a "typing" placeholder
    const id = uid()
    setBubbles(prev => [...prev, { id, type: 'user', text: '' }])
    for (let i = 1; i <= text.length; i++) {
      setBubbles(prev => prev.map(b => b.id === id ? { ...b, text: text.slice(0, i) } : b))
      await sleep(38 + Math.random() * 28)
    }
    await sleep(350)
  }

  async function streamSQL(sql: string, attempt: number) {
    const id = uid()
    setBubbles(prev => [...prev, { id, type: 'sql_attempt', sql: '', attempt }])
    let built = ''
    for (const line of sql.split('\n')) {
      built += (built ? '\n' : '') + line
      setBubbles(prev => prev.map(b => b.id === id ? { ...b, sql: built } : b))
      await sleep(100 + Math.random() * 75)
    }
    await sleep(300)
    // Remove the streaming placeholder (the caller will push the final bubble)
    setBubbles(prev => prev.filter(b => b.id !== id))
  }

  const playQuery = useCallback(async (def: QueryDef) => {
    setAppState('running')

    try {
      await typeUser(def.q)
      await sleep(400)

      for (let i = 0; i < def.attempts.length; i++) {
        const att = def.attempts[i]
        const attNum = i + 1

        // Show thinking
        push({ type: 'thinking', thoughts: att.thoughts })
        await sleep(600 + att.thoughts.length * 550)
        replaceLast({ type: 'thinking', thoughts: att.thoughts }) // freeze it

        await sleep(250)

        await streamSQL(att.sql, attNum)

        if ('error' in att) {
          push({ type: 'sql_err', text: att.error, sql: att.sql, attempt: attNum })
          await sleep(700)
        } else {
          push({ type: 'sql_ok', sql: att.sql, rows: att.rows, attempt: attNum, badge: def.badge })
          await sleep(1200)
        }
      }

      if (def.failed) {
        push({ type: 'failed', text: `Failed after ${def.attempts.length} attempts — errors recorded for GEPA` })
        await sleep(800)
      }
    } catch { /* cancelled */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const playGepa = useCallback(async (fromGen: number, toGen: number) => {
    setAppState('gepa')
    try {
      await sleep(600)

      const steps = [
        '🧠 Analyzing failure patterns from recent queries…',
        '🔍 Identifying missing rules from error traces…',
        '✍️  Rewriting system prompt with targeted fixes…',
        '📐 Benchmarking new prompt on golden query set…',
      ]

      const statusId = uid()
      setBubbles(prev => [...prev, { id: statusId, type: 'thinking', thoughts: [steps[0]] }])
      for (let si = 1; si < steps.length; si++) {
        await sleep(1300)
        setBubbles(prev => prev.map(b =>
          b.id === statusId ? { ...b, thoughts: steps.slice(0, si + 1) } : b
        ))
      }
      await sleep(1200)
      setBubbles(prev => prev.filter(b => b.id !== statusId))

      // Animate score
      const from = SCORES[fromGen], to = SCORES[toGen]
      for (let i = 0; i <= 40; i++) {
        setScore(from + (to - from) * (i / 40))
        await sleep(22)
      }

      const lines = diffPrompts(fromGen, toGen)
      setGen(toGen)
      setScoreHist(prev => [...prev, to])
      setDiffLines(lines)

      // Show inline diff in chat
      push({ type: 'gepa_diff', diff: { from: fromGen, to: toGen, lines } })
      await sleep(1000)
    } catch { /* cancelled */ }
  }, [])

  const autoPlay = useCallback(async () => {
    cancel.current = false
    setStarted(true)
    setAppState('running')

    try {
      // ── Round 1: baseline prompt — queries will fail and self-debug ──
      for (const id of ROUND_1) {
        await playQuery(QUERIES[id])
        setDoneSets(prev => ({ ...prev, r1: new Set([...prev.r1, id]) }))
        await sleep(900)
      }

      // ── GEPA optimization cycle 1 ──
      await playGepa(0, 1)
      setRound(2)
      await sleep(800)

      // ── Round 2: evolved prompt — same queries, first-try success ──
      for (const id of ROUND_2) {
        await playQuery(QUERIES[id])
        setDoneSets(prev => ({ ...prev, r2: new Set([...prev.r2, id]) }))
        await sleep(900)
      }

      // ── GEPA optimization cycle 2 ──
      await playGepa(1, 2)
      setRound('end')
      setAppState('done')
    } catch { /* cancelled */ }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playQuery, playGepa])

  function resetDemo() {
    cancel.current = true
    setTimeout(() => {
      cancel.current = false
      setBubbles([])
      setAppState('idle')
      setRound(1)
      setDoneSets({ r1: new Set(), r2: new Set() })
      setGen(0)
      setScore(SCORES[0])
      setScoreHist([SCORES[0]])
      setDiffLines(PROMPTS[0].split('\n').map(t => ({ kind: 'same' as const, text: t })))
      setStarted(false)
    }, 80)
  }

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [bubbles])

  useEffect(() => {
    return () => { cancel.current = true }
  }, [])

  const isDark   = dark
  const bg       = isDark ? '#06060f' : '#f8f9fc'
  const bg2      = isDark ? '#080810' : '#ffffff'
  const br       = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.08)'
  const tx       = isDark ? '#f1f5f9' : '#0f172a'
  const mu       = isDark ? '#64748b' : '#94a3b8'
  const phaseLabel = appState === 'gepa'
    ? { text: 'GEPA optimizing…',      dot: isDark ? '#a78bfa' : '#7c3aed', pulse: true  }
    : round === 'end'
    ? { text: 'Demo complete',          dot: '#4ade80',                       pulse: false }
    : !started
    ? { text: 'Ready',                  dot: isDark ? '#6b7280' : '#94a3b8',  pulse: false }
    : round === 1
    ? { text: 'Baseline — Gen 0',       dot: isDark ? '#6b7280' : '#94a3b8',  pulse: appState === 'running' }
    : { text: 'Evolved — Gen 1',        dot: '#4ade80',                       pulse: appState === 'running' }

  return (
    <div className="h-screen flex flex-col overflow-hidden" style={{ background: bg, color: tx, fontFamily: 'ui-monospace,"SF Mono",Consolas,monospace' }}>

      {/* ── Header ── */}
      <header className="shrink-0 flex items-center justify-between px-5 py-3 border-b" style={{ background: bg2, borderColor: br }}>
        <div className="flex items-center gap-3">
          <div className="w-7 h-7 rounded-lg flex items-center justify-center text-sm"
            style={{ background: 'rgba(124,58,237,0.2)', border: '1px solid rgba(124,58,237,0.35)' }}>⚡</div>
          <div>
            <p className="text-sm font-bold leading-none">GEPA SQL Agent</p>
            <p className="text-[10px] mt-0.5" style={{ color: mu }}>Prompt evolution through automated learning</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Phase pill */}
          <div className="flex items-center gap-1.5 text-[10px] rounded-full px-2.5 py-1 border"
            style={{ color: phaseLabel.dot, borderColor: phaseLabel.dot + '40' }}>
            <span className="w-1.5 h-1.5 rounded-full"
              style={{ background: phaseLabel.dot, animation: phaseLabel.pulse ? 'pulse 1s infinite' : undefined }} />
            {phaseLabel.text}
          </div>

          {/* Gen + score */}
          <div className="hidden sm:flex items-center gap-2 text-[11px]" style={{ color: mu }}>
            <span>Gen <span className="font-bold" style={{ color: tx }}>{gen}</span></span>
            <span className="font-bold" style={{ color: scoreColor(score) }}>{(score * 100).toFixed(0)}%</span>
          </div>

          {/* ER Diagram */}
          <button onClick={() => setShowER(true)}
            className="text-[11px] px-2.5 py-1 rounded-lg border transition-opacity hover:opacity-70"
            style={{ color: isDark ? '#818cf8' : '#6366f1', background: isDark ? 'rgba(129,140,248,0.08)' : 'rgba(99,102,241,0.06)', borderColor: isDark ? 'rgba(129,140,248,0.25)' : 'rgba(99,102,241,0.2)' }}>
            ER Diagram
          </button>

          {/* Connect DB */}
          <button onClick={() => setConnectModalOpen(true)}
            className="text-[11px] px-2.5 py-1 rounded-lg border transition-opacity hover:opacity-70"
            style={{ color: mu, borderColor: br }}>
            Connect DB
          </button>

          {/* Theme toggle */}
          <button onClick={() => setDark(!dark)}
            className="w-7 h-7 rounded-lg flex items-center justify-center border text-sm transition-opacity hover:opacity-70"
            style={{ borderColor: br, color: mu }}>
            {dark ? '☀' : '🌙'}
          </button>
        </div>
      </header>

      {/* ── Body ── */}
      <div className="flex-1 flex overflow-hidden">

        {/* ── Chat ── */}
        <div className="flex-1 flex flex-col overflow-hidden min-w-0">
          {/* Schema strip */}
          <div className="shrink-0 flex items-center gap-2 px-5 py-1.5 border-b" style={{ borderColor: br, background: isDark ? 'rgba(255,255,255,0.01)' : 'rgba(0,0,0,0.02)' }}>
            <span className="text-[9px] uppercase tracking-wider" style={{ color: mu }}>schema</span>
            {['customers','orders','order_items','products','categories'].map(t => (
              <span key={t} className="text-[9px] font-mono rounded px-1.5 py-0.5"
                style={{ color: isDark ? '#9ca3af' : '#64748b', background: isDark ? 'rgba(255,255,255,0.03)' : '#f1f5f9', border: `1px solid ${br}` }}>
                {t}
              </span>
            ))}
            <span className="ml-auto text-[9px]" style={{ color: isDark ? '#374151' : '#cbd5e1' }}>ecommerce.db · SQLite</span>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
            {bubbles.length === 0 && (
              <div className="flex flex-col items-center justify-center h-full gap-4 text-center pb-8">
                <div className="text-4xl">⚡</div>
                <div>
                  <p className="text-sm font-semibold mb-1" style={{ color: tx }}>GEPA SQL Agent</p>
                  <p className="text-xs max-w-xs" style={{ color: mu }}>
                    Watch the agent generate SQL, fail, self-debug, and evolve its prompt through two optimization cycles — fully automated.
                  </p>
                </div>
                <button
                  onClick={autoPlay}
                  className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold transition-opacity hover:opacity-80"
                  style={{ background: 'rgba(124,58,237,0.2)', border: '1px solid rgba(124,58,237,0.45)', color: '#c4b5fd' }}
                >
                  <span>▶</span> Start Demo
                </button>
                <p className="text-[10px]" style={{ color: isDark ? '#374151' : '#cbd5e1' }}>No input required · ~90 seconds</p>
              </div>
            )}

            {bubbles.map(b => <Bubble key={b.id} b={b} dark={isDark} />)}

            {/* End summary */}
            {round === 'end' && appState === 'done' && (
              <EndSummary dark={isDark} onConnect={() => setConnectModalOpen(true)} />
            )}

            <div ref={endRef} />
          </div>

          {/* ── Footer: start / status / replay ── */}
          <div className="shrink-0 px-5 py-3 border-t flex items-center gap-3" style={{ borderColor: br, background: isDark ? 'rgba(255,255,255,0.01)' : 'rgba(0,0,0,0.01)' }}>
            {!started && appState === 'idle' && (
              <button
                onClick={autoPlay}
                className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-opacity hover:opacity-80"
                style={{ background: 'rgba(124,58,237,0.2)', border: '1px solid rgba(124,58,237,0.45)', color: '#c4b5fd' }}
              >
                <span style={{ fontSize: 13 }}>▶</span> Start Demo
              </button>
            )}
            {started && appState !== 'done' && (
              <div className="flex items-center gap-2 text-[11px]" style={{ color: mu }}>
                <span className="w-1.5 h-1.5 rounded-full bg-violet-500" style={{ animation: 'pulse 1s infinite' }} />
                {appState === 'gepa'
                  ? 'GEPA optimizer rewriting system prompt…'
                  : round === 2
                  ? 'Round 2 — evolved prompt in action…'
                  : 'Agent is working…'}
              </div>
            )}
            {appState === 'done' && (
              <div className="flex items-center gap-3">
                <p className="text-[11px]" style={{ color: mu }}>Demo complete</p>
                <button
                  onClick={resetDemo}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-opacity hover:opacity-80"
                  style={{ background: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)', border: `1px solid ${br}`, color: mu }}
                >
                  ↺ Replay
                </button>
              </div>
            )}
          </div>
        </div>

        {/* ── Right panel ── */}
        <div className="w-[280px] shrink-0 flex flex-col overflow-hidden border-l" style={{ borderColor: br, background: isDark ? '#050510' : '#f4f4f8' }}>
          <div className="shrink-0 px-4 py-2.5 border-b" style={{ borderColor: br }}>
            <h2 className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: mu }}>Prompt Evolution</h2>
          </div>
          <PromptPanel gen={gen} score={score} history={scoreHist} diffLines={diffLines} dark={isDark} />
        </div>
      </div>

      {/* ── ER Diagram modal ── */}
      {showER && <ERDModal onClose={() => setShowER(false)} dark={isDark} />}

      {/* ── Connect modal ── */}
      <ConnectModal onConnect={(_schema: SchemaGraph, _tables: TableStat[], _config: DBConfig) => {
        setConnectModalOpen(false)
        window.location.href = '/demo'
      }} />

      <style jsx global>{`
        @keyframes pulse { 0%,100% { opacity:1 } 50% { opacity:0.4 } }
      `}</style>
    </div>
  )
}
