# TODO

## P0 — Bugs (breaks core functionality)

- [x] **Fix UI freeze on `agent_error`** — `agent_error` event not handled in switch → `isRunning` stays `true` forever
- [x] **Fix UI freeze on malformed SSE** — `JSON.parse` had no try-catch in stream reader; any bad chunk crashed the loop
- [x] **Add top-level `runQuery` try-catch** — network failures now call `finishQuery(false)` instead of silently locking the UI
- [ ] **GEPA fires on query count only** — currently triggers at exactly 4/8/12. Should also trigger when failure rate spikes (e.g. 3 consecutive failures). Change `shouldOptimize()` to check failure streaks.
- [ ] **`useLayoutEffect` imported but unused** in `ERDiagram.tsx` — causes React warning
- [ ] **Duplicate `Database` import** at bottom of `ERDiagram.tsx` — move to top with other imports

---

## P1 — Makes the demo tell the research story

- [ ] **GEPA Live Diff panel** — when GEPA fires, show a side-by-side or line diff of Gen N-1 vs Gen N system prompt (red = removed lines, green = added). This is the core "wow" moment. Currently it's just a text banner.
- [ ] **Query history list** — scrollable list of all past queries with: question (truncated), attempt count badge (green=1, yellow=2, red=3+), success/fail icon. Currently only the current query is visible.
- [ ] **Persistent status bar** — thin bar under the header always showing: `Gen 2 · 12 queries · 83% success · avg 1.8 attempts`. Currently you have to scroll the right panel to see this.
- [ ] **Auto-expand System Prompt when GEPA fires** — the most important panel is collapsed by default. Should pop open automatically when a new optimization completes.
- [ ] **Reset Demo button** — wipes DB + GEPA history + query history + starts fresh. Essential for running the demo twice.
- [ ] **"0 rows — click Generate Data" hint** — after DDL, table stat chips show "0" with no guidance. Add a tooltip or inline nudge pointing to the data size picker.

---

## P2 — Layout & visual polish

- [ ] **Widen centre panel** — left sidebar currently 256px, right 288px, leaving centre too narrow on 1440px screens. Reduce left to 220px. Make right panel collapsible (hide button).
- [ ] **Horizontal scroll for suggestion chips** — currently wraps to multiple lines and gets truncated. Use `overflow-x-auto flex-nowrap` with a scroll container.
- [ ] **ER diagram zoom controls** — add `+` / `-` buttons and scroll-wheel zoom. With 8 tables the diagram can be taller than the viewport.
- [ ] **Copy button on attempt SQL cards** in `DebugLoop.tsx` — let users grab the SQL from any attempt.
- [ ] **Attempt timeline connector** — draw a thin vertical line connecting attempt cards so it reads as a flow, not a list. Show an arrow between "error" and the next "generating" card.
- [ ] **Empty state for right panel graph** — the graph shows a `TrendingDown` icon with text, but the three stat cards (queries/attempts/success) should show `--` placeholders instead of not rendering at all.

---

## P3 — Features

- [ ] **SQL syntax highlighting in Playground** — replace the plain textarea with a tokenizer-based highlight (can use a tiny library like `react-simple-code-editor` + `prism-js` for SQL)
- [ ] **Table browser search / column filter** — text input above the table grid that filters rows client-side
- [ ] **Download CSV** — add a small CSV export button to `TableBrowser` and `ResultsTable`
- [ ] **Animated graph data points** — when a new query completes, animate the new dot entering the performance chart
- [ ] **GEPA candidate viewer** — show all 3 candidates on the Pareto front simultaneously (the current one + the two alternatives), so you can see the diversity GEPA maintains

---

## Novel Ideas to Implement (from research)

These are extensions that would make this a publishable demo or research tool:

### Quick wins
- [ ] **MCP Tool Description Optimizer tab** — add a 5th tab where you define tools (name + description) and let GEPA optimize the descriptions based on whether the agent calls them correctly. Directly uses the research concept, zero new LLM infrastructure needed.
- [ ] **"Challenge Mode"** — a second LLM generates adversarial queries designed to break the current system prompt. GEPA evolves against the adversary. Shows automated red-teaming.

### Medium effort
- [ ] **Prompt Archaeology view** — a timeline visualization showing each rule that was added to the system prompt, which failure triggered it, and whether queries that triggered it subsequently succeeded. Like git blame but for the prompt.
- [ ] **Cross-session prompt transfer** — "Export optimized prompt" button that saves the current Gen-N prompt. "Import prompt" button that loads it as the seed for a fresh session. Lets you demonstrate that learned knowledge transfers without retraining.
- [ ] **Multi-objective Pareto visualization** — plot each candidate prompt on a 2D scatter (x = success rate, y = avg attempts). Show the Pareto frontier updating live as GEPA runs.

### Research-grade
- [ ] **Hard vs Soft signal A/B test** — toggle between "execution feedback" (SQL errors from SQLite) and "LLM-as-judge feedback" (ask the LLM to rate the SQL quality). Compare convergence rates on the same query set. Quantifies the value of ground-truth signals.
- [ ] **Multi-schema transfer experiment** — run GEPA on E-commerce for 20 queries, then switch to Banking with the learned prompt as seed. Measure how many queries reach peak performance vs cold-starting. Tests whether GEPA learns general SQL knowledge or schema-specific tricks.
- [ ] **GEPA vs manual prompt engineering** — add a "Manual" mode where a human can edit the system prompt directly. Compare the human-tuned prompt vs GEPA's prompt after 20 queries. Benchmark: which reaches higher success rate faster?

---

## How to Make the Demo Better (presentation tips)

1. **Pre-populate the database before the demo** — 10K rows takes ~45s. Do it beforehand so you can jump straight to queries.
2. **Have a saved "after GEPA" state** — pre-run 8 queries in private, save the Gen-2 prompt, screenshot the performance graph. Open with this state loaded to show the end state before explaining the beginning.
3. **Use Banking schema for the main demo** — it has the richest ER diagram (8 tables, lots of FK lines) and the hardest query patterns (running balances, fraud detection, loan defaults).
4. **Run the same query before and after GEPA fires** — "Find accounts that went negative more than twice" — at Gen 0 it takes 3 attempts; at Gen 2 it takes 1. The graph shows this visually.
5. **Open the System Prompt panel and scroll it slowly** — the rules that GEPA added (specific SQLite syntax, column name patterns) are surprisingly readable and obviously "earned" from failures. This is a great explainer moment.
6. **Show the ER diagram while explaining a hard query** — "This query joins 4 tables — you can see how they connect here" while hovering the FK lines.
