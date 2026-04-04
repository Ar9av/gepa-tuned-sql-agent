# gepa-tuned-sql-agent

A live demo of two research ideas running together in one Next.js app:

1. **Self-Refine / Self-Debug** — the agent critiques and fixes its own SQL errors in a loop, no human in the loop
2. **GEPA (Genetic-Pareto Evolutionary Prompt Optimization)** — after every 4 queries, an LLM reflects on failure patterns and evolves the system prompt

The result: the agent gets measurably faster and more accurate over time — **without retraining or fine-tuning the model**. Pure prompt + context engineering.

---

## Demo Flow

```
1. Pick a schema (E-commerce / Hospital / Banking)
   → LLM writes the CREATE TABLE script live, streams to UI

2. Pick data size (500 / 2K / 10K rows) → Generate Data
   → LLM writes a SQLite recursive CTE population script
   → Executes live, fills all tables

3. Ask hard natural-language questions
   → Watch: generate SQL → execute → diagnose error → retry loop
   → After 4 queries, GEPA fires: reflects on failures, mutates the prompt

4. Run 10+ queries
   → Performance graph: attempts-per-query trends down
   → System prompt evolves — Gen 0 (5 lines) → Gen 2 (specific earned rules)
```

---

## Setup

```bash
git clone https://github.com/Ar9av/gepa-tuned-sql-agent
cd gepa-tuned-sql-agent
npm install
```

Create `.env.local`:

```env
AZURE_API_KEY=your_key_here
AZURE_BASE_URL=https://your-endpoint.services.ai.azure.com/models
AZURE_MODEL=grok-4-1-fast-reasoning
```

```bash
npm run dev
# open http://localhost:3000
```

Uses **SQLite in-process** via `better-sqlite3` — no Docker, no external database. One command runs everything.

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Next.js 16 (App Router)               │
│                                                          │
│  Left sidebar          Centre (tabs)       Right         │
│  ─────────────         ─────────────       ─────         │
│  Schema picker    →    AI Agent tab        GEPA          │
│  Data generator        ER Diagram tab      Progress      │
│  System Prompt         Table Browser tab   Graph         │
│  (evolving live)       SQL Playground tab               │
└──────────────────────────────┬──────────────────────────┘
                               │ SSE streaming
┌──────────────────────────────▼──────────────────────────┐
│                    API Routes (Node.js)                   │
│                                                          │
│  /api/generate-schema   DDL-only, FK-safe topo sort      │
│  /api/populate-data     LLM writes recursive CTEs        │
│  /api/execute-query     self-debug loop + GEPA trigger   │
│  /api/schema-graph      PRAGMA-based ER extraction       │
│  /api/table-data        paginated row fetch              │
│  /api/execute-sql       raw SQL playground               │
└──────────────────────────────┬──────────────────────────┘
                               │
                    SQLite (better-sqlite3)
                    Azure AI Foundry (OpenAI-compatible)
```

### Self-Debug Loop (`lib/sql-agent.ts`)

```
for attempt 1..5:
  generate SQL    streaming, error-context injected on retries
  execute         against SQLite
  if success    → record result for GEPA, return rows
  if fail       → stream 1-sentence diagnosis (precise, names exact issue)
                → inject error + schema + previous SQL into next attempt
```

### GEPA Optimizer (`lib/gepa.ts`)

Fires every 4 queries. Three steps:

```
1. REFLECT   LLM reads the last 8 failures
             → diagnoses recurring patterns
             "column name mismatches, missing GROUP BY before HAVING..."

2. MUTATE    LLM writes an improved system prompt
             → adds specific SQLite rules earned by real failures
             → does NOT add generic fluff

3. SELECT    New candidate joins Pareto front (top 3 kept by score)
             Best candidate becomes the active system prompt going forward
```

---

## Research Background

### 1. Self-Refine & Self-Correction

> *"LLM generation is done in a single pass — susceptible to errors in long or complex outputs. Self-refinement closes the loop: generate → critique → refine."*
> — CMU LLM Inference course

- **Self-Refine** (Madaan et al., 2023): LLMs iteratively improve their own outputs using self-generated feedback, no training. Works best when the model isn't already near-optimal on the task.
- **Self-Debugging** (Chen et al., 2023): Adds hard external signals — code execution + stack traces — to the critique step. A single self-debug run outperforms sampling 16 candidates via self-consistency.
- **Key insight in this demo**: SQL execution errors from SQLite are hard ground-truth signals — far stronger than LLM self-critique alone. The error message names the exact column, the exact syntax issue.
- **Lecture reference**: [CMU LLM Inference (8): Self-Refine and Self-Correction Methods](https://www.youtube.com/watch?v=uaxf9yssDy4)

### 2. GEPA — Reflective Prompt Evolution

> *"Rather than collapsing execution traces into a scalar reward, GEPA uses LLM reflection as a text-domain gradient — outperforming RL while using 35x fewer evaluations."*

- **Paper**: [GEPA: Reflective Prompt Evolution Can Outperform Reinforcement Learning](https://arxiv.org/abs/2507.19457)
- **GitHub**: [gepa-ai/gepa](https://github.com/gepa-ai/gepa)
- **DSPy integration docs**: [dspy.ai/api/optimizers/GEPA/overview/](https://dspy.ai/api/optimizers/GEPA/overview/)

Benchmark results from the paper:

| Task | Before GEPA | After GEPA |
|---|---|---|
| AIME math (GPT-4.1 Mini) | 46.6% | 56.6% (+10pp) |
| ARC-AGI agent | 32 | 89 |
| MATH benchmark (DSPy full program) | 67% | 93% |
| vs RL (GRPO) | — | +6pp avg, up to +19pp |
| vs best prior prompt optimizer | — | +10–12pp |
| vs RL on rollout count | 5,000–25,000 | 100–500 (35x fewer) |

Production users cited in the paper: Shopify, Databricks, Dropbox, OpenAI, Pydantic.

This demo implements the GEPA loop **in TypeScript (~150 lines)** without the Python library — showing the algorithm is simple enough to embed in any LLM pipeline.

### 3. Post-Training Foundations: RL → Prompt Space

> *"GEPA is RL — but at the prompt space instead of the weight space. You get continuous improvement without owning model weights."*

- **Reference**: [From Q-Learning to LLMs: Mastering the Bedrock of Post-Training](https://medium.com/learnwithnk/from-q-learning-to-llms-mastering-the-bedrock-of-post-training-8e80491f3a01)

Conceptual lineage: Q-Learning → Actor-Critic → PPO/GRPO → GEPA. Each step addressed the previous method's core failure mode:

| Method | Problem it solved | Problem it introduced |
|---|---|---|
| Q-Learning | Bellman-based credit assignment | Dimensionality explosion at LLM scale |
| Actor-Critic | Scalable with function approximation | Instability, sample inefficiency |
| PPO/GRPO | Stable policy updates | Requires model weights + thousands of rollouts |
| **GEPA** | Works via API only, 35x fewer evals | Needs a strong reflection LLM |

---

## Novel Extension Ideas

### Drop-in (low effort)

| Idea | What it demonstrates |
|---|---|
| **MCP Tool Description Optimizer** | Apply GEPA to the text descriptions of agent tools. The LLM reads tool descriptions to decide how to call them — GEPA improves those descriptions based on call success rate. GEPA already has a native MCP adapter in Python. |
| **Multi-Schema Transfer** | Train GEPA on E-commerce for 20 queries, then load the Gen-3 prompt as seed for Banking. Does it learn general SQL or schema-specific tricks? Quantifies transferability. |
| **Adversarial Query Generator** | A second LLM generates queries designed to break the current system prompt. GEPA co-evolves against the adversary. Automated red-teaming at zero cost. |

### Medium effort

| Idea | What it demonstrates |
|---|---|
| **Prompt Archaeology Timeline** | Visualize each rule added to the system prompt: which failure triggered it, and whether queries that triggered it subsequently succeeded. Like git blame for the prompt. |
| **Cross-Session Transfer** | "Export optimized prompt" → saves Gen-N prompt to clipboard/file. "Import prompt" → loads it as seed for a fresh session. Demonstrates knowledge transfer without retraining. |
| **Pareto Front Scatter Plot** | Each GEPA candidate plotted on 2D (x = success rate, y = avg attempts). Show the Pareto frontier updating live. Makes the multi-objective optimization visible. |

### Research-grade

| Idea | What it demonstrates |
|---|---|
| **Hard vs Soft Signal A/B** | Toggle between SQL execution feedback (ground truth) and LLM-as-judge feedback. Compare convergence on the same query set. Quantifies the value of hard signals. |
| **Multi-Objective GEPA** | Two signals: accuracy + query execution time (ms). Pareto front shows accuracy vs speed tradeoffs — useful for BI dashboards where some queries can be approximate. |
| **GEPA vs Manual Prompt Engineering** | Add a "Manual" mode where a human edits the prompt directly. Compare: who reaches higher success rate faster after 20 queries? |

---

## How to Demo This Effectively

1. **Pre-generate data before the demo** — 10K rows takes ~45s. Do it before presenting.
2. **Use Banking schema** — richest ER diagram (8 tables, lots of FK lines), hardest query patterns (fraud, loan defaults, running balances).
3. **Use the pre-built challenging queries** — designed to fail on attempt 1 so you can show the full debug loop.
4. **Run 8–10 queries before explaining GEPA** — let the graph build up, then point to where the optimization fired.
5. **Open System Prompt before and after GEPA** — Gen 0 is 5 generic lines; Gen 2 has specific SQLite rules earned from real failures. The contrast is the "wow" moment.
6. **Re-run a query that previously took 3 attempts** — at Gen 2 it should succeed in 1. Show this side-by-side.
7. **Switch to ER Diagram and hover tables** — FK lines highlight, showing the schema complexity that makes these queries hard to write.

---

## Stack

| | |
|---|---|
| Framework | Next.js 16, TypeScript, App Router |
| Styling | Tailwind CSS |
| Animations | Framer Motion |
| Charts | Recharts |
| Database | SQLite (better-sqlite3, in-process) |
| LLM | Azure AI Foundry (OpenAI-compatible SDK) |
| State | Zustand |
| Icons | Lucide React |

---

## TODO

### 🐛 Bugs

- [x] **UI freeze on `agent_error`** — event not handled in switch → `isRunning` stuck true forever → fixed
- [x] **UI freeze on malformed SSE** — `JSON.parse` had no try-catch → fixed
- [x] **Top-level `runQuery` try-catch** — network failures now call `finishQuery(false)` → fixed
- [ ] **GEPA fires on query count only** — currently triggers at 4/8/12 regardless. Should also trigger on consecutive failures (e.g. 3 in a row). Change `shouldOptimize()` in `lib/gepa.ts` to check failure streaks.
- [ ] **`useLayoutEffect` imported but unused** in `ERDiagram.tsx` — causes React warning in dev
- [ ] **Duplicate `Database` import** at bottom of `ERDiagram.tsx` — should be at top with other imports

### 🔴 UX — Makes the demo tell the research story

- [ ] **GEPA Live Diff panel** — when optimization fires, show a line-by-line diff of the prompt (Gen N-1 vs Gen N). Red = removed, green = added. Currently just a text banner — the diff IS the demo moment.
- [ ] **Query history list** — scrollable list of all past queries with attempt count badge (green=1, yellow=2, red=3+) and success/fail icon. Currently only the active query is visible.
- [ ] **Persistent status bar** — thin bar under header always showing: `Gen 2 · 12 queries · 83% success · avg 1.8 attempts`. Currently hidden in the right panel.
- [ ] **Auto-expand System Prompt on GEPA fire** — the most important panel is collapsed by default. Should open automatically when a new optimization completes.
- [ ] **Reset Demo button** — wipes DB + GEPA history + query history + returns to Gen 0. Essential for re-running the demo.
- [ ] **"0 rows — click Generate Data" hint** — after DDL, table chips show "0" with no guidance. Add an inline nudge pointing to the data size picker.

### 🟡 Layout & Visual Polish

- [ ] **Widen centre panel** — left sidebar 256px + right 288px leaves centre too narrow on 1440px screens. Reduce left to 220px, make right panel collapsible.
- [ ] **Horizontal scroll for suggestion chips** — currently wraps to multiple lines. Use `overflow-x-auto flex-nowrap` scroll container.
- [ ] **ER diagram zoom controls** — `+` / `−` buttons and scroll-to-zoom. With 8 tables the diagram can overflow the viewport.
- [ ] **Attempt timeline connector** — draw a vertical line connecting attempt cards so it reads as a flow. Add an arrow between error and the next generating card.
- [ ] **Copy button on attempt SQL cards** in `DebugLoop.tsx`
- [ ] **Empty state stat cards** — the three stats (queries/attempts/success) should show `--` placeholders before any queries run, rather than not rendering.

### 🟢 Features

- [ ] **SQL syntax highlighting in Playground** — replace plain textarea with `react-simple-code-editor` + prism for SQL
- [ ] **Table browser column filter** — text input that filters rows client-side
- [ ] **Download CSV** — export button in Table Browser and ResultsTable
- [ ] **Animated graph data points** — animate the new dot entering the chart when a query completes
- [ ] **GEPA candidate viewer** — show all 3 Pareto front candidates simultaneously so you can see the diversity GEPA maintains

### 🔬 Novel Ideas to Implement

- [ ] **MCP Tool Description Optimizer tab** — 5th tab where you define agent tools and GEPA optimizes their descriptions based on call success rate
- [ ] **Challenge Mode** — second LLM generates adversarial queries to break the current prompt; GEPA co-evolves
- [ ] **Prompt Archaeology view** — timeline of each rule added, which failure triggered it, whether it helped
- [ ] **Cross-session prompt export/import** — save Gen-N prompt, load as seed for fresh session
- [ ] **Hard vs Soft signal A/B toggle** — compare execution feedback vs LLM-as-judge convergence on the same query set
