'use client'

import { useState, useEffect, useRef } from 'react'

// ── Prompt generations ───────────────────────────────────────────────────────

const P: Record<number, string> = {
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

// ── Types ────────────────────────────────────────────────────────────────────

type DiffLine = { kind: 'same' | 'add'; text: string }

interface BubbleData {
  id: number
  type: 'user' | 'sql_ok' | 'sql_err' | 'failed' | 'gepa'
  text: string
  sql?: string
  rows?: Record<string, string | number>[]
  attempt?: number
  badge?: string
}

type Attempt =
  | { sql: string; error: string }
  | { sql: string; success: true; rows: Record<string, string | number>[] }

type Scene =
  | { kind: 'query'; q: string; badge?: string; attempts: Attempt[]; failed?: true }
  | { kind: 'gepa'; toGen: number }

// ── Demo script ──────────────────────────────────────────────────────────────

const SCRIPT: Scene[] = [
  // Act 1 — baseline: rough edges, failures recorded silently
  {
    kind: 'query',
    q: 'Show me total revenue by product category',
    attempts: [
      {
        sql: 'SELECT category, SUM(price) AS revenue\nFROM orders\nGROUP BY category\nORDER BY revenue DESC',
        error: 'no such column: category',
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
      },
    ],
  },
  {
    kind: 'query',
    q: 'Top 5 customers by lifetime value?',
    failed: true,
    attempts: [
      {
        sql: 'SELECT id, name, SUM(total) AS ltv\nFROM customers JOIN orders ON id = customer_id\nGROUP BY id ORDER BY ltv DESC LIMIT 5',
        error: 'ambiguous column name: id',
      },
      {
        sql: 'SELECT c.id, c.name, SUM(o.total_amount) AS ltv\nFROM customers c\nJOIN orders o ON c.id = o.customer_id\nGROUP BY c.id ORDER BY ltv DESC LIMIT 5',
        error: 'no such column: o.total_amount',
      },
      {
        sql: 'SELECT c.id, c.name,\n       SUM(oi.quantity * oi.unit_price) AS ltv\nFROM customers c\nJOIN orders o      ON c.id = o.customer_id\nJOIN order_items   ON o.id = order_id\nGROUP BY c.id ORDER BY ltv DESC LIMIT 5',
        error: 'ambiguous column name: order_id',
      },
    ],
  },
  {
    kind: 'query',
    q: 'Monthly revenue trend — last 6 months',
    failed: true,
    attempts: [
      {
        sql: "SELECT strftime('%Y-%m', created_at) AS month,\n       SUM(amount) AS revenue\nFROM orders\nWHERE created_at >= date('now','-6 months')\nGROUP BY month ORDER BY month",
        error: 'no such column: amount',
      },
      {
        sql: "SELECT strftime('%Y-%m', o.created_at) AS month,\n       SUM(oi.quantity * oi.unit_price) AS revenue\nFROM orders o\nJOIN order_items oi ON o.id = oi.order_id\nWHERE o.created_at >= date('now','-6 months')\nGROUP BY month ORDER BY month",
        error: 'query returned 0 rows — date filter too restrictive',
      },
    ],
  },

  // GEPA learns from 2 silent failures
  { kind: 'gepa', toGen: 1 },

  // Act 2 — improved prompt, same hard questions
  {
    kind: 'query',
    q: 'Show me total revenue by product category',
    badge: '✓ 1st try',
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
      },
    ],
  },
  {
    kind: 'query',
    q: 'Top 5 customers by lifetime value?',
    badge: '✓ 1st try',
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
      },
    ],
  },

  // GEPA learns again
  { kind: 'gepa', toGen: 2 },

  // Act 3 — hardest query, now first try
  {
    kind: 'query',
    q: 'Monthly revenue trend — last 6 months',
    badge: '✓ 1st try',
    attempts: [
      {
        sql: "SELECT strftime('%Y-%m', o.created_at)  AS month,\n       SUM(oi.quantity * oi.unit_price) AS revenue\nFROM orders      o\nJOIN order_items oi ON o.id = oi.order_id\nGROUP BY month\nORDER BY month DESC\nLIMIT 6",
        success: true,
        rows: [
          { month: '2025-12', revenue: 52300 },
          { month: '2025-11', revenue: 48750 },
          { month: '2025-10', revenue: 61200 },
          { month: '2025-09', revenue: 44100 },
          { month: '2025-08', revenue: 39800 },
          { month: '2025-07', revenue: 55600 },
        ],
      },
    ],
  },
]

// ── Utilities ────────────────────────────────────────────────────────────────

function diffPrompts(prev: string, next: string): DiffLine[] {
  const prevSet = new Set(prev.split('\n'))
  return next.split('\n').map(text => ({
    kind: prevSet.has(text) ? 'same' : 'add',
    text,
  }))
}

function scoreColor(s: number) {
  return s > 0.82 ? '#4ade80' : s > 0.66 ? '#facc15' : '#f87171'
}

// ── Sub-components ───────────────────────────────────────────────────────────

function ScoreChart({ history }: { history: number[] }) {
  const W = 240; const H = 52
  if (history.length < 2) return (
    <div className="h-[52px] flex items-center justify-center text-[10px] text-gray-800 italic">
      waiting for first optimization…
    </div>
  )
  const pts = history.map((s, i) => {
    const x = (i / (history.length - 1)) * W
    const y = H - s * H
    return `${x.toFixed(1)},${y.toFixed(1)}`
  })
  const polyPts = pts.join(' ')
  const areaPts = `${polyPts} ${W},${H} 0,${H}`
  return (
    <svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="w-full">
      <defs>
        <linearGradient id="cg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#a78bfa" stopOpacity="0.35" />
          <stop offset="100%" stopColor="#a78bfa" stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={areaPts} fill="url(#cg)" />
      <polyline points={polyPts} fill="none" stroke="#a78bfa" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
      {history.map((s, i) => {
        const x = (i / (history.length - 1)) * W
        const y = H - s * H
        return <circle key={i} cx={x.toFixed(1)} cy={y.toFixed(1)} r="3.5" fill="#a78bfa" />
      })}
    </svg>
  )
}

function Bubble({ b }: { b: BubbleData }) {
  if (b.type === 'user') return (
    <div className="flex justify-end">
      <div className="bg-violet-600/20 border border-violet-500/30 rounded-2xl rounded-br-sm px-4 py-2.5 max-w-[88%]">
        <p className="text-sm text-white font-medium">{b.text}</p>
      </div>
    </div>
  )

  if (b.type === 'sql_err') return (
    <div className="space-y-1.5">
      {b.sql && (
        <div className="bg-white/[0.025] border border-white/[0.06] rounded-xl p-3">
          <div className="text-[10px] text-gray-700 mb-1.5 font-mono">Attempt {b.attempt}</div>
          <pre className="text-[11px] font-mono text-gray-400 whitespace-pre overflow-x-auto leading-relaxed">{b.sql}</pre>
        </div>
      )}
      <div className="flex items-start gap-2 text-xs text-red-400 bg-red-500/5 border border-red-500/15 rounded-xl px-3 py-2">
        <span className="shrink-0">✗</span>
        <span className="font-mono">{b.text}</span>
      </div>
    </div>
  )

  if (b.type === 'sql_ok') {
    const cols = b.rows && b.rows.length > 0 ? Object.keys(b.rows[0]) : []
    return (
      <div className="space-y-2">
        <div className="bg-white/[0.025] border border-white/[0.06] rounded-xl p-3">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[10px] text-gray-700 font-mono">Attempt {b.attempt}</span>
            {b.badge && (
              <span className="text-[10px] text-emerald-400 bg-emerald-500/10 border border-emerald-500/25 rounded px-1.5 py-0.5 font-semibold">
                {b.badge}
              </span>
            )}
          </div>
          <pre className="text-[11px] font-mono text-emerald-400 whitespace-pre overflow-x-auto leading-relaxed">{b.sql}</pre>
        </div>
        {b.rows && cols.length > 0 && (
          <div className="bg-white/[0.015] border border-white/[0.05] rounded-xl overflow-hidden">
            <table className="w-full text-xs font-mono">
              <thead>
                <tr className="border-b border-white/[0.05]">
                  {cols.map(k => <th key={k} className="px-3 py-1.5 text-left text-gray-600 font-normal">{k}</th>)}
                </tr>
              </thead>
              <tbody>
                {b.rows.map((row, ri) => (
                  <tr key={ri} className="border-b border-white/[0.03] last:border-0">
                    {cols.map(k => (
                      <td key={k} className="px-3 py-1.5 text-gray-300">
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
    <div className="flex items-center gap-2 text-xs text-red-300 bg-red-500/8 border border-red-500/20 rounded-xl px-3 py-2.5 font-medium">
      <span>❌</span><span>{b.text}</span>
    </div>
  )

  if (b.type === 'gepa') return (
    <div className="flex items-center gap-2 text-xs text-violet-300 bg-violet-500/10 border border-violet-500/25 rounded-xl px-3 py-2.5 font-semibold">
      <span>⚡</span><span>{b.text}</span>
    </div>
  )

  return null
}

// ── Main ─────────────────────────────────────────────────────────────────────

export default function ShowcasePage() {
  const [bubbles, setBubbles]         = useState<BubbleData[]>([])
  const [typing, setTyping]           = useState('')
  const [sqlStream, setSqlStream]     = useState('')
  const [gepaMsg, setGepaMsg]         = useState('')
  const [gen, setGen]                 = useState(0)
  const [score, setScore]             = useState(SCORES[0])
  const [scoreHist, setScoreHist]     = useState<number[]>([SCORES[0]])
  const [diffLines, setDiffLines]     = useState<DiffLine[]>(
    P[0].split('\n').map(t => ({ kind: 'same' as const, text: t }))
  )
  const [phase, setPhase] = useState<'baseline' | 'optimizing' | 'evolved'>('baseline')

  const cancel = useRef(false)
  const idRef  = useRef(0)
  const endRef = useRef<HTMLDivElement>(null)

  const uid = () => ++idRef.current

  function sleep(ms: number) {
    return new Promise<void>((res, rej) => {
      const t = setTimeout(() => cancel.current ? rej() : res(), ms)
      return () => clearTimeout(t)
    })
  }

  function push(b: Omit<BubbleData, 'id'>) {
    setBubbles(prev => [...prev, { ...b, id: uid() }])
  }

  async function typeUser(text: string) {
    setTyping('')
    for (let i = 1; i <= text.length; i++) {
      setTyping(text.slice(0, i))
      await sleep(30 + Math.random() * 20)
    }
    await sleep(220)
    setTyping('')
    push({ type: 'user', text })
  }

  async function streamSQL(sql: string) {
    setSqlStream('')
    let built = ''
    for (const line of sql.split('\n')) {
      built += (built ? '\n' : '') + line
      setSqlStream(built)
      await sleep(95 + Math.random() * 70)
    }
    await sleep(220)
    setSqlStream('')
  }

  async function playQuery(scene: Extract<Scene, { kind: 'query' }>) {
    await typeUser(scene.q)
    await sleep(320)
    for (let i = 0; i < scene.attempts.length; i++) {
      const att = scene.attempts[i]
      await streamSQL(att.sql)
      await sleep(180)
      if ('error' in att) {
        push({ type: 'sql_err', text: att.error, sql: att.sql, attempt: i + 1 })
        await sleep(650)
      } else {
        push({ type: 'sql_ok', text: '', sql: att.sql, rows: att.rows, attempt: i + 1, badge: scene.badge })
        await sleep(1300)
      }
    }
    if (scene.failed) {
      push({ type: 'failed', text: `Failed after ${scene.attempts.length} attempts — GEPA will learn from this` })
      await sleep(850)
    }
  }

  async function playGepa(scene: Extract<Scene, { kind: 'gepa' }>) {
    const toGen = scene.toGen
    const frGen = toGen - 1
    setPhase('optimizing')

    const steps = [
      '🧠 Analyzing failure patterns from recent queries…',
      '🔍 Identifying missing rules from error traces…',
      '✍️  Rewriting system prompt with targeted fixes…',
      '📐 Benchmarking new prompt on golden query set…',
    ]
    for (const s of steps) {
      setGepaMsg(s)
      await sleep(1350)
    }
    setGepaMsg('')

    // Animate score counter
    const from = SCORES[frGen], to = SCORES[toGen]
    for (let i = 0; i <= 40; i++) {
      setScore(from + (to - from) * (i / 40))
      await sleep(22)
    }

    setGen(toGen)
    setScoreHist(prev => [...prev, to])
    setDiffLines(diffPrompts(P[frGen], P[toGen]))
    setPhase('evolved')

    push({
      type: 'gepa',
      text: `Prompt updated — Generation ${toGen} · Score ${(to * 100).toFixed(0)}%  (+${((to - from) * 100).toFixed(0)}pp)`,
    })
    await sleep(2000)
  }

  async function loop() {
    cancel.current = false
    setBubbles([])
    setTyping('')
    setSqlStream('')
    setGepaMsg('')
    setGen(0)
    setScore(SCORES[0])
    setScoreHist([SCORES[0]])
    setDiffLines(P[0].split('\n').map(t => ({ kind: 'same', text: t })))
    setPhase('baseline')
    idRef.current = 0

    try {
      await sleep(700)
      for (const scene of SCRIPT) {
        if (scene.kind === 'gepa') await playGepa(scene)
        else                        await playQuery(scene)
        await sleep(450)
      }
      await sleep(3000)
      loop()
    } catch { /* cancelled */ }
  }

  useEffect(() => {
    loop()
    return () => { cancel.current = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [bubbles, typing, sqlStream, gepaMsg])

  const phaseUI = {
    baseline:   { label: 'Baseline prompt',    dot: 'bg-gray-500',    text: 'text-gray-400'   },
    optimizing: { label: 'GEPA optimizing…',   dot: 'bg-violet-400 animate-pulse', text: 'text-violet-300' },
    evolved:    { label: 'Evolved prompt',      dot: 'bg-emerald-400', text: 'text-emerald-300' },
  }[phase]

  const addedCount = diffLines.filter(l => l.kind === 'add').length

  return (
    <div
      className="h-screen flex flex-col overflow-hidden bg-[#06060f] text-white"
      style={{ fontFamily: 'ui-monospace, "SF Mono", Consolas, monospace' }}
    >
      {/* ── Header ── */}
      <header className="shrink-0 flex items-center justify-between px-5 py-3 border-b border-white/[0.06] bg-[#080810]">
        <div className="flex items-center gap-3">
          <div className="w-7 h-7 rounded-lg bg-violet-600/25 border border-violet-500/35 flex items-center justify-center text-[15px]">⚡</div>
          <div>
            <p className="text-sm font-bold leading-none text-white">GEPA SQL Agent</p>
            <p className="text-[10px] text-gray-600 mt-0.5">Prompt evolution through automated learning · live demo</p>
          </div>
        </div>

        <div className="flex items-center gap-4">
          {/* Phase pill */}
          <div className={`flex items-center gap-1.5 text-[10px] border border-current/20 rounded-full px-2.5 py-1 ${phaseUI.text}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${phaseUI.dot}`} />
            {phaseUI.label}
          </div>

          {/* Gen + score */}
          <div className="text-[11px] text-gray-600 font-mono">
            Gen <span className="text-white font-bold">{gen}</span>
          </div>
          <div
            className="text-[13px] font-bold font-mono transition-colors duration-300"
            style={{ color: scoreColor(score) }}
          >
            {(score * 100).toFixed(1)}%
          </div>
        </div>
      </header>

      {/* ── Body ── */}
      <div className="flex-1 flex overflow-hidden">

        {/* ── Chat ── */}
        <div className="flex-1 flex flex-col overflow-hidden min-w-0">

          {/* Schema strip */}
          <div className="shrink-0 flex items-center gap-2 px-5 py-1.5 border-b border-white/[0.04] bg-[#07070e]">
            <span className="text-[9px] text-gray-700 uppercase tracking-wider">schema</span>
            {['customers','orders','order_items','products','categories'].map(t => (
              <span key={t} className="text-[9px] font-mono text-gray-600 bg-white/[0.03] border border-white/[0.05] rounded px-1.5 py-0.5">{t}</span>
            ))}
            <span className="ml-auto text-[9px] text-gray-800">ecommerce.db · SQLite</span>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
            {bubbles.map(b => <Bubble key={b.id} b={b} />)}

            {/* Typing */}
            {typing && (
              <div className="flex justify-end">
                <div className="bg-violet-600/20 border border-violet-500/30 rounded-2xl rounded-br-sm px-4 py-2.5 max-w-[88%]">
                  <span className="text-sm text-white font-medium">{typing}</span>
                  <span className="animate-pulse text-violet-400 ml-0.5">▋</span>
                </div>
              </div>
            )}

            {/* Streaming SQL */}
            {sqlStream && (
              <div className="bg-white/[0.025] border border-white/[0.06] rounded-xl p-3">
                <div className="text-[10px] text-gray-700 mb-1.5 font-mono flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-violet-500 animate-pulse" />
                  Generating SQL…
                </div>
                <pre className="text-[11px] font-mono text-gray-300 whitespace-pre overflow-x-auto leading-relaxed">
                  {sqlStream}<span className="animate-pulse text-gray-600">▋</span>
                </pre>
              </div>
            )}

            {/* GEPA spinner */}
            {gepaMsg && (
              <div className="flex items-center gap-3 text-sm text-violet-300 bg-violet-500/8 border border-violet-500/25 rounded-xl px-4 py-3">
                <span className="shrink-0 text-base" style={{ animation: 'spin 1.8s linear infinite', display: 'inline-block' }}>⚙</span>
                <span>{gepaMsg}</span>
              </div>
            )}

            <div ref={endRef} />
          </div>
        </div>

        {/* ── Right panel: prompt evolution ── */}
        <div className="w-[300px] shrink-0 flex flex-col overflow-hidden border-l border-white/[0.06] bg-[#050510]">
          <div className="shrink-0 px-4 py-2.5 border-b border-white/[0.06]">
            <h2 className="text-[10px] font-semibold text-gray-500 uppercase tracking-widest">Prompt Evolution</h2>
          </div>

          <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">

            {/* Score bar */}
            <div>
              <div className="flex justify-between text-[10px] mb-1.5">
                <span className="text-gray-600">Benchmark score</span>
                <span className="font-bold font-mono transition-colors duration-300" style={{ color: scoreColor(score) }}>
                  {(score * 100).toFixed(1)}%
                </span>
              </div>
              <div className="h-1.5 bg-white/[0.06] rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-75"
                  style={{ width: `${score * 100}%`, backgroundColor: scoreColor(score) }}
                />
              </div>
              {gen > 0 && (
                <p className="text-[10px] text-emerald-500 mt-1">
                  +{((SCORES[gen] - SCORES[0]) * 100).toFixed(0)}pp vs baseline
                </p>
              )}
            </div>

            {/* Score history */}
            <div>
              <div className="text-[10px] text-gray-700 mb-1.5">Score history</div>
              <ScoreChart history={scoreHist} />
            </div>

            {/* Generation */}
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-gray-600">Generation</span>
              <span className="text-[11px] font-mono font-bold text-violet-300 bg-violet-500/10 border border-violet-500/25 rounded px-2 py-0.5">
                {gen}
              </span>
              {addedCount > 0 && (
                <span className="ml-auto text-[9px] text-emerald-500 bg-emerald-500/8 border border-emerald-500/20 rounded px-1.5 py-0.5">
                  +{addedCount} rules
                </span>
              )}
            </div>

            {/* Prompt diff */}
            <div>
              <div className="text-[10px] text-gray-600 mb-1.5">Current system prompt</div>
              <div className="bg-[#020208] border border-white/[0.05] rounded-lg p-2.5 text-[10px] overflow-x-auto max-h-[320px] overflow-y-auto">
                {diffLines.map((line, i) => (
                  <div
                    key={i}
                    className={
                      line.kind === 'add'
                        ? 'flex gap-1.5 text-emerald-300 bg-emerald-500/10 rounded px-1 my-0.5'
                        : 'text-gray-600 px-1'
                    }
                  >
                    {line.kind === 'add' && <span className="text-emerald-500 select-none shrink-0">+</span>}
                    <span>{line.text || '\u00a0'}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Legend */}
            <div className="text-[10px] text-gray-700 space-y-1 pt-1 border-t border-white/[0.04]">
              <div className="flex items-center gap-1.5">
                <span className="text-emerald-500 font-bold">+</span>
                <span>Rule learned from query failures</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="text-gray-600">·</span>
                <span>Unchanged rule</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <style jsx global>{`
        @keyframes spin { to { transform: rotate(360deg) } }
      `}</style>
    </div>
  )
}
