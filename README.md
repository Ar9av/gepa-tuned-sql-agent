# gepa-tuned-sql-agent

A live demo of two research ideas running together in one Next.js app:

1. **Self-Refine / Self-Debug** — the agent critiques and fixes its own SQL errors in a loop, no human in the loop
2. **GEPA (Genetic-Pareto Evolutionary Prompt Optimization)** — after every 4 queries, an LLM reflects on failure patterns and evolves the system prompt, scored against a **golden benchmark dataset**

The result: the agent gets measurably faster and more accurate over time — **without retraining or fine-tuning the model**. Pure prompt + context engineering.

---

## Demo Flow

```
1. App loads → benchmark dataset auto-seeded in SQLite (no setup required)
   → 16-table Marketplace Analytics schema (vendors, products, orders,
     categories hierarchy, inventory logs, promotions, referral chains)
   → ~1,000 rows of realistic data, pre-populated deterministically

2. Benchmark tab shows 20 hard analytical questions (designed by Claude Opus)
   → Click "Run All" to evaluate the SQL agent on all 20 questions
   → Each question runs: generate SQL → execute → compare vs reference SQL

3. Scoring is ground-truth based:
   → Reference SQL is run first to establish the expected output
   → Agent SQL is compared: row count, column match, value overlap
   → Score = 70% reference comparison + 30% structural validation
   → "reference: 12 rows  agent: 0 rows" shown per query

4. After every 4 queries, GEPA fires:
   → Reflects on failures, generates improved system prompt
   → Mini-benchmark (5 queries) scores the new prompt candidate — real score, not a guess
   → Prompt evolution panel shows Gen 0 → Gen N with what changed and why

5. Re-run benchmark → score goes up
   → Performance graph shows attempts-per-query trending down
   → System prompt evolves from 5 generic lines to specific earned SQLite rules
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
AZURE_MODEL=gpt-5.4-nano
```

```bash
npm run dev
# open http://localhost:3000
```

The benchmark dataset seeds automatically on first load. No schema generation step, no data population step — the demo is ready immediately.

Uses **SQLite in-process** via `better-sqlite3` — no Docker, no external database. One command runs everything.

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Next.js (App Router)                   │
│                                                          │
│  Left sidebar        Centre (tabs)         Right         │
│  ─────────────       ─────────────         ─────         │
│  Dataset info   →    Benchmark tab   →     GEPA          │
│  Table stats         ER Diagram tab        Prompt        │
│  (pre-seeded)        Table Browser tab     Evolution     │
│                      SQL Playground tab    Graph         │
└──────────────────────────────┬──────────────────────────┘
                               │ SSE streaming
┌──────────────────────────────▼──────────────────────────┐
│                    API Routes (Node.js)                   │
│                                                          │
│  /api/init           seed benchmark DB on first load     │
│  /api/benchmark      run golden queries, stream results  │
│  /api/execute-query  self-debug loop + GEPA trigger      │
│  /api/schema-graph   PRAGMA-based ER extraction          │
│  /api/table-data     paginated row fetch                 │
│  /api/execute-sql    raw SQL playground                  │
└──────────────────────────────┬──────────────────────────┘
                               │
                    SQLite (better-sqlite3)
                    Azure AI Foundry (OpenAI-compatible)
```

### Benchmark Dataset (`lib/seed.ts` + `lib/schemas/benchmark.ts`)

16-table Marketplace Analytics schema, seeded deterministically (no LLM):

| Table | Description |
|---|---|
| `customers` | Self-referential (referral chains) |
| `customer_addresses` | Multi-address per customer |
| `vendors` | With commission rates |
| `vendor_payouts` | Quarterly payout tracking |
| `categories` | 3-level hierarchy (self-referential) |
| `products` | With cost/price for margin queries |
| `product_images` | Many-per-product |
| `tags` + `product_tags` | Many-to-many |
| `orders` | With status lifecycle |
| `order_items` | Per-product line items |
| `order_events` | Time-series event log (created→shipped→delivered) |
| `reviews` | Verified purchase flag |
| `promotions` | Discount campaigns |
| `promotion_redemptions` | Usage tracking |
| `inventory_logs` | Time-series stock changes |

### Golden Dataset (`lib/golden-dataset.ts`)

20 benchmark questions designed by Claude Opus, ranging from `hard` to `expert`:

| Concept | Example queries |
|---|---|
| Window functions + LAG | Week-over-week revenue change |
| Recursive CTEs | Category path building, referral chain depth |
| Gaps-and-islands | Customers with 3+ consecutive months of rising spend |
| Self-join | Most frequent product-pair co-purchases |
| Correlated subqueries | Products above category-average return rate |
| Cohort analysis | LTV by signup month, retention matrix |
| Percentile estimation | p50/p90 fulfillment time per vendor |
| NTILE scoring | RFM customer scoring model |
| Set operations | Active products never ordered |
| Multi-level aggregation | Revenue rollup by category tree |

Each query has a `referenceSQL` (correct answer) and a `validate()` function. The benchmark runs both and compares outputs.

### Scoring Algorithm (`lib/benchmark.ts`)

```
For each golden query:
  1. Run referenceSQL → refRows (ground truth)
  2. Generate agent SQL via LLM
  3. Execute agent SQL → agentRows
  4. Compare:
       count score    = min/max ratio of row counts
       column score   = fuzzy match of column names
       value score    = overlap of first-column values
       reference score = 0.4 * count + 0.3 * columns + 0.3 * values
  5. Final = reference_score * 0.7 + structural_validate * 0.3
  6. Pass threshold: score >= 0.7
```

If reference returns rows but agent returns 0 → score 0.0 (hard fail, no lenient "zero rows valid").

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

3. EVALUATE  Mini-benchmark: run gq-01 through gq-05 with the new prompt
             → real score replaces the old optimistic heuristic
             → new candidate joins Pareto front (top 3 kept by score)
             → best candidate becomes active system prompt
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

## How to Demo This Effectively

1. **Open the app** — dataset loads instantly, no setup. Go straight to the Benchmark tab.
2. **Run All** — watch all 20 queries execute with live pass/fail status. Note the initial score (typically 30–50%).
3. **Expand a failing query** — show `reference: 8 rows  agent: 0 rows`. Explain why the agent's SQL is wrong (e.g., invalid SQLite date syntax).
4. **Ask a few free-form questions** in the AI Agent tab — let the debug loop run, show retries.
5. **Wait for GEPA to fire** (every 4 queries) — watch the Prompt Evolution panel update. Gen 0 is 5 generic lines; Gen 2 has specific SQLite rules.
6. **Re-run benchmark** — score goes up. Show the diff: which queries flipped from fail to pass.
7. **Open ER Diagram** — show the 16-table schema complexity that makes these queries hard.

---

## Stack

| | |
|---|---|
| Framework | Next.js, TypeScript, App Router |
| Styling | Tailwind CSS |
| Animations | Framer Motion |
| Charts | Recharts |
| Database | SQLite (better-sqlite3, in-process) |
| LLM | Azure AI Foundry (OpenAI-compatible SDK) |
| State | Zustand |
| Icons | Lucide React |
