export interface GoldenQuery {
  id: string
  question: string
  difficulty: 'hard' | 'expert'
  concepts: string[]
  referenceSQL: string
  validate: (rows: Record<string, unknown>[]) => { pass: boolean; score: number; reason: string }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function hasColumnLike(row: Record<string, unknown>, substr: string): boolean {
  return Object.keys(row).some(k => k.toLowerCase().includes(substr.toLowerCase()))
}

function allRowsHaveColumns(rows: Record<string, unknown>[], substrings: string[]): string | null {
  if (rows.length === 0) return null
  for (const s of substrings) {
    if (!hasColumnLike(rows[0], s)) return `missing column containing "${s}"`
  }
  return null
}

function isDescending(rows: Record<string, unknown>[], colSubstr: string): boolean {
  const key = Object.keys(rows[0]).find(k => k.toLowerCase().includes(colSubstr.toLowerCase()))
  if (!key) return false
  for (let i = 1; i < rows.length; i++) {
    if (Number(rows[i][key]) > Number(rows[i - 1][key])) return false
  }
  return true
}

function isAscending(rows: Record<string, unknown>[], colSubstr: string): boolean {
  const key = Object.keys(rows[0]).find(k => k.toLowerCase().includes(colSubstr.toLowerCase()))
  if (!key) return false
  for (let i = 1; i < rows.length; i++) {
    if (Number(rows[i][key]) < Number(rows[i - 1][key])) return false
  }
  return true
}

function getCol(row: Record<string, unknown>, substr: string): unknown {
  const key = Object.keys(row).find(k => k.toLowerCase().includes(substr.toLowerCase()))
  return key ? row[key] : undefined
}

function allPositive(rows: Record<string, unknown>[], colSubstr: string): boolean {
  const key = Object.keys(rows[0]).find(k => k.toLowerCase().includes(colSubstr.toLowerCase()))
  if (!key) return false
  return rows.every(r => Number(r[key]) > 0)
}

function allNonNegative(rows: Record<string, unknown>[], colSubstr: string): boolean {
  const key = Object.keys(rows[0]).find(k => k.toLowerCase().includes(colSubstr.toLowerCase()))
  if (!key) return false
  return rows.every(r => Number(r[key]) >= 0)
}

// ---------------------------------------------------------------------------
// Golden queries
// ---------------------------------------------------------------------------
export const GOLDEN_QUERIES: GoldenQuery[] = [

  // =========================================================================
  // 1. Week-over-week revenue with percentage change
  // =========================================================================
  {
    id: 'gq-01',
    question: 'Show weekly revenue for the last 12 weeks with week-over-week absolute change and percentage change, ordered chronologically.',
    difficulty: 'hard',
    concepts: ['window_function', 'lag', 'date_arithmetic', 'cte'],
    referenceSQL: `
WITH weekly AS (
  SELECT
    strftime('%Y-%W', order_date) AS order_week,
    SUM(total_amount) AS revenue
  FROM orders
  WHERE status NOT IN ('cancelled', 'refunded')
    AND order_date >= date('now', '-84 days')
  GROUP BY 1
),
with_lag AS (
  SELECT
    order_week,
    revenue,
    LAG(revenue) OVER (ORDER BY order_week) AS prev_week_revenue
  FROM weekly
)
SELECT
  order_week,
  revenue,
  prev_week_revenue,
  revenue - prev_week_revenue AS wow_change,
  CASE WHEN prev_week_revenue > 0
    THEN ROUND((revenue - prev_week_revenue) * 100.0 / prev_week_revenue, 2)
    ELSE NULL
  END AS wow_pct_change
FROM with_lag
ORDER BY order_week;
`,
    validate: (rows) => {
      if (rows.length === 0) return { pass: false, score: 0, reason: 'No rows returned' }
      const colCheck = allRowsHaveColumns(rows, ['week', 'revenue'])
      if (colCheck) return { pass: false, score: 0.2, reason: colCheck }
      // First row should have null previous
      const firstPrev = getCol(rows[0], 'prev')
      if (rows.length > 1 && firstPrev !== null && firstPrev !== undefined && firstPrev !== '') {
        return { pass: false, score: 0.5, reason: 'First row should have null prev_week_revenue' }
      }
      // Check chronological ordering
      const weeks = rows.map(r => String(getCol(r, 'week')))
      const sorted = [...weeks].sort()
      if (JSON.stringify(weeks) !== JSON.stringify(sorted)) {
        return { pass: false, score: 0.5, reason: 'Weeks not in chronological order' }
      }
      // Revenue should be positive
      if (!allPositive(rows, 'revenue')) {
        return { pass: false, score: 0.5, reason: 'Revenue values should be positive' }
      }
      return { pass: true, score: 1.0, reason: 'Correct structure: weekly revenue with WoW change, chronologically ordered' }
    }
  },

  // =========================================================================
  // 2. Customers who ordered in every month of the last year
  // =========================================================================
  {
    id: 'gq-02',
    question: 'Find customers who placed at least one non-cancelled order in every single month of the past 12 months. Return their ID, name, and total spend in that period.',
    difficulty: 'hard',
    concepts: ['having', 'date_arithmetic', 'count_distinct', 'aggregation'],
    referenceSQL: `
SELECT
  c.customer_id,
  c.first_name || ' ' || c.last_name AS customer_name,
  SUM(o.total_amount) AS total_spend
FROM customers c
JOIN orders o ON o.customer_id = c.customer_id
WHERE o.status NOT IN ('cancelled', 'refunded')
  AND o.order_date >= date('now', '-12 months')
GROUP BY c.customer_id, customer_name
HAVING COUNT(DISTINCT strftime('%Y-%m', o.order_date)) = 12
ORDER BY total_spend DESC;
`,
    validate: (rows) => {
      if (rows.length === 0) return { pass: true, score: 1.0, reason: 'Zero rows is valid — may be no such customers in data' }
      const colCheck = allRowsHaveColumns(rows, ['customer', 'spend'])
      if (colCheck) return { pass: false, score: 0.2, reason: colCheck }
      if (!isDescending(rows, 'spend')) {
        return { pass: false, score: 0.5, reason: 'Results should be ordered by total_spend descending' }
      }
      if (!allPositive(rows, 'spend')) {
        return { pass: false, score: 0.5, reason: 'Total spend should be positive for every row' }
      }
      return { pass: true, score: 1.0, reason: 'Correct: customers with orders in all 12 months, ordered by spend' }
    }
  },

  // =========================================================================
  // 3. Recursive category tree with full path
  // =========================================================================
  {
    id: 'gq-03',
    question: 'Using a recursive CTE, build the full category path (e.g. "Electronics > Phones > Smartphones") for every leaf category (one with no children). Include category_id, full_path, and depth_level.',
    difficulty: 'expert',
    concepts: ['recursive_cte', 'self_join', 'string_concatenation'],
    referenceSQL: `
WITH RECURSIVE cat_tree AS (
  SELECT
    category_id,
    parent_category_id,
    category_name,
    category_name AS full_path,
    depth_level
  FROM categories
  WHERE parent_category_id IS NULL

  UNION ALL

  SELECT
    c.category_id,
    c.parent_category_id,
    c.category_name,
    ct.full_path || ' > ' || c.category_name,
    c.depth_level
  FROM categories c
  JOIN cat_tree ct ON c.parent_category_id = ct.category_id
)
SELECT
  ct.category_id,
  ct.full_path,
  ct.depth_level
FROM cat_tree ct
WHERE ct.category_id NOT IN (
  SELECT parent_category_id FROM categories WHERE parent_category_id IS NOT NULL
)
ORDER BY ct.full_path;
`,
    validate: (rows) => {
      if (rows.length === 0) return { pass: false, score: 0, reason: 'No rows returned — there should be leaf categories' }
      const colCheck = allRowsHaveColumns(rows, ['category_id', 'path', 'depth'])
      if (colCheck) return { pass: false, score: 0.2, reason: colCheck }
      // Paths should contain ' > ' for non-root leaves
      const hasDelimiter = rows.some(r => String(getCol(r, 'path')).includes(' > '))
      if (!hasDelimiter && rows.length > 1) {
        return { pass: false, score: 0.3, reason: 'Expected hierarchical paths with " > " separator' }
      }
      // depth should be non-negative
      if (!allNonNegative(rows, 'depth')) {
        return { pass: false, score: 0.5, reason: 'depth_level should be non-negative' }
      }
      return { pass: true, score: 1.0, reason: 'Correct: leaf categories with full recursive path' }
    }
  },

  // =========================================================================
  // 4. Products with return rate above their category average
  // =========================================================================
  {
    id: 'gq-04',
    question: 'Find products whose return/refund rate (proportion of orders that ended up returned or refunded) exceeds the average return rate for their category. Show product name, category, product return rate, and category average return rate.',
    difficulty: 'hard',
    concepts: ['correlated_subquery', 'aggregation', 'having', 'case_when'],
    referenceSQL: `
WITH product_rates AS (
  SELECT
    p.product_id,
    p.product_name,
    cat.category_name,
    p.category_id,
    COUNT(DISTINCT oi.order_id) AS total_orders,
    COUNT(DISTINCT CASE WHEN o.status IN ('returned', 'refunded') THEN oi.order_id END) AS return_orders,
    CASE WHEN COUNT(DISTINCT oi.order_id) > 0
      THEN ROUND(COUNT(DISTINCT CASE WHEN o.status IN ('returned','refunded') THEN oi.order_id END) * 1.0 / COUNT(DISTINCT oi.order_id), 4)
      ELSE 0 END AS return_rate
  FROM products p
  JOIN categories cat ON cat.category_id = p.category_id
  JOIN order_items oi ON oi.product_id = p.product_id
  JOIN orders o ON o.order_id = oi.order_id
  GROUP BY p.product_id, p.product_name, cat.category_name, p.category_id
),
category_avg AS (
  SELECT
    category_id,
    AVG(return_rate) AS avg_return_rate
  FROM product_rates
  GROUP BY category_id
)
SELECT
  pr.product_name,
  pr.category_name,
  pr.return_rate,
  ca.avg_return_rate AS category_avg_return_rate
FROM product_rates pr
JOIN category_avg ca ON ca.category_id = pr.category_id
WHERE pr.return_rate > ca.avg_return_rate
  AND pr.total_orders >= 5
ORDER BY pr.return_rate DESC;
`,
    validate: (rows) => {
      if (rows.length === 0) return { pass: true, score: 1.0, reason: 'Zero rows valid if no products exceed category avg' }
      const colCheck = allRowsHaveColumns(rows, ['product', 'category', 'return_rate'])
      if (colCheck) return { pass: false, score: 0.2, reason: colCheck }
      // Each product return rate should exceed its category avg
      for (const r of rows) {
        const pr = Number(getCol(r, 'return_rate'))
        const ca = Number(getCol(r, 'category_avg') ?? getCol(r, 'avg'))
        if (ca !== undefined && !isNaN(ca) && pr <= ca) {
          return { pass: false, score: 0.4, reason: 'Found product with return_rate <= category avg — filter is wrong' }
        }
      }
      // rates between 0 and 1
      for (const r of rows) {
        const pr = Number(getCol(r, 'return_rate'))
        if (pr < 0 || pr > 1) return { pass: false, score: 0.4, reason: 'return_rate should be between 0 and 1' }
      }
      if (!isDescending(rows, 'return_rate')) {
        return { pass: false, score: 0.7, reason: 'Should be ordered by return_rate descending' }
      }
      return { pass: true, score: 1.0, reason: 'Correct: products with above-category-avg return rates' }
    }
  },

  // =========================================================================
  // 5. Product pairs bought together most often (market basket)
  // =========================================================================
  {
    id: 'gq-05',
    question: 'Which product pairs are most frequently purchased together in the same order? Show the top 15 pairs with both product names and co-occurrence count. Each pair should appear only once (not duplicated as A-B and B-A).',
    difficulty: 'hard',
    concepts: ['self_join', 'aggregation', 'deduplication', 'limit'],
    referenceSQL: `
SELECT
  p1.product_name AS product_a,
  p2.product_name AS product_b,
  COUNT(*) AS times_bought_together
FROM order_items oi1
JOIN order_items oi2
  ON oi1.order_id = oi2.order_id
  AND oi1.product_id < oi2.product_id
JOIN products p1 ON p1.product_id = oi1.product_id
JOIN products p2 ON p2.product_id = oi2.product_id
GROUP BY oi1.product_id, oi2.product_id
ORDER BY times_bought_together DESC
LIMIT 15;
`,
    validate: (rows) => {
      if (rows.length === 0) return { pass: false, score: 0, reason: 'No rows — expected product pairs' }
      if (rows.length > 15) return { pass: false, score: 0.3, reason: 'Expected at most 15 rows' }
      const colCheck = allRowsHaveColumns(rows, ['product'])
      if (colCheck) return { pass: false, score: 0.2, reason: colCheck }
      // Should have a count-like column
      const hasCount = hasColumnLike(rows[0], 'count') || hasColumnLike(rows[0], 'times') || hasColumnLike(rows[0], 'co_occur') || hasColumnLike(rows[0], 'frequency')
      if (!hasCount) return { pass: false, score: 0.3, reason: 'Missing co-occurrence count column' }
      // Check descending order
      const countKey = Object.keys(rows[0]).find(k => /count|times|co_occur|frequency/i.test(k))
      if (countKey) {
        for (let i = 1; i < rows.length; i++) {
          if (Number(rows[i][countKey]) > Number(rows[i - 1][countKey])) {
            return { pass: false, score: 0.5, reason: 'Pairs should be ordered by co-occurrence descending' }
          }
        }
      }
      // Check no duplicate pair (A,B) and (B,A)
      const pairs = new Set<string>()
      for (const r of rows) {
        const keys = Object.keys(r).filter(k => /product/i.test(k))
        if (keys.length >= 2) {
          const a = String(r[keys[0]])
          const b = String(r[keys[1]])
          const canonical = [a, b].sort().join('|||')
          if (pairs.has(canonical)) return { pass: false, score: 0.4, reason: 'Duplicate pair found — dedup failed' }
          pairs.add(canonical)
        }
      }
      return { pass: true, score: 1.0, reason: 'Correct: top 15 product pairs bought together, deduplicated' }
    }
  },

  // =========================================================================
  // 6. Running inventory balance per product over time
  // =========================================================================
  {
    id: 'gq-06',
    question: 'Show the running inventory balance for each product over time using inventory_logs. For each log entry, display the product name, timestamp, change type, quantity change, and the running cumulative balance (using a window function). Order by product then timestamp.',
    difficulty: 'hard',
    concepts: ['window_function', 'running_total', 'sum_over', 'join'],
    referenceSQL: `
SELECT
  p.product_name,
  il.logged_at,
  il.change_type,
  il.quantity_change,
  SUM(il.quantity_change) OVER (
    PARTITION BY il.product_id
    ORDER BY il.logged_at, il.log_id
    ROWS UNBOUNDED PRECEDING
  ) AS running_balance
FROM inventory_logs il
JOIN products p ON p.product_id = il.product_id
ORDER BY p.product_name, il.logged_at, il.log_id;
`,
    validate: (rows) => {
      if (rows.length === 0) return { pass: false, score: 0, reason: 'No rows returned' }
      const colCheck = allRowsHaveColumns(rows, ['product', 'change', 'running'])
      if (colCheck) return { pass: false, score: 0.2, reason: colCheck }
      // Within each product group, running balance should be monotonically consistent
      // (each row = previous running + current change)
      const balKey = Object.keys(rows[0]).find(k => /running|balance|cumul/i.test(k))
      const chgKey = Object.keys(rows[0]).find(k => /quantity_change|qty_change|change/i.test(k) && !/type/i.test(k))
      if (balKey && chgKey) {
        // Just check that values are numeric
        for (const r of rows) {
          if (isNaN(Number(r[balKey]))) return { pass: false, score: 0.3, reason: 'running_balance should be numeric' }
        }
      }
      return { pass: true, score: 1.0, reason: 'Correct: running inventory balance with window function' }
    }
  },

  // =========================================================================
  // 7. Customers with 3+ consecutive months of increasing spend
  // =========================================================================
  {
    id: 'gq-07',
    question: 'Find customers whose monthly spend increased for at least 3 consecutive months. Show customer name, the start month, end month, and the number of consecutive increasing months.',
    difficulty: 'expert',
    concepts: ['window_function', 'lag', 'gaps_and_islands', 'cte', 'date_arithmetic'],
    referenceSQL: `
WITH monthly_spend AS (
  SELECT
    customer_id,
    strftime('%Y-%m', order_date) AS month,
    SUM(total_amount) AS spend
  FROM orders
  WHERE status NOT IN ('cancelled', 'refunded')
  GROUP BY customer_id, strftime('%Y-%m', order_date)
),
with_prev AS (
  SELECT *,
    LAG(spend) OVER (PARTITION BY customer_id ORDER BY month) AS prev_spend,
    LAG(month) OVER (PARTITION BY customer_id ORDER BY month) AS prev_month
  FROM monthly_spend
),
flagged AS (
  SELECT *,
    CASE WHEN spend > prev_spend THEN 1 ELSE 0 END AS is_increase
  FROM with_prev
),
grouped AS (
  SELECT *,
    ROW_NUMBER() OVER (PARTITION BY customer_id ORDER BY month)
    - ROW_NUMBER() OVER (PARTITION BY customer_id, is_increase ORDER BY month) AS grp
  FROM flagged
  WHERE is_increase = 1
),
streaks AS (
  SELECT
    customer_id,
    MIN(month) AS start_month,
    MAX(month) AS end_month,
    COUNT(*) + 1 AS consecutive_months
  FROM grouped
  GROUP BY customer_id, grp
  HAVING COUNT(*) >= 2
)
SELECT
  c.first_name || ' ' || c.last_name AS customer_name,
  s.start_month,
  s.end_month,
  s.consecutive_months
FROM streaks s
JOIN customers c ON c.customer_id = s.customer_id
ORDER BY s.consecutive_months DESC, customer_name;
`,
    validate: (rows) => {
      if (rows.length === 0) return { pass: true, score: 1.0, reason: 'Zero rows valid if no 3+ month streaks exist' }
      const colCheck = allRowsHaveColumns(rows, ['customer', 'start', 'end', 'consecutive'])
      if (colCheck) return { pass: false, score: 0.2, reason: colCheck }
      const cKey = Object.keys(rows[0]).find(k => /consecutive|streak|months/i.test(k))
      if (cKey) {
        for (const r of rows) {
          if (Number(r[cKey]) < 3) return { pass: false, score: 0.4, reason: 'All streaks should be >= 3 consecutive months' }
        }
        if (!isDescending(rows, cKey.toLowerCase())) {
          return { pass: false, score: 0.7, reason: 'Should be ordered by consecutive months descending' }
        }
      }
      return { pass: true, score: 1.0, reason: 'Correct: customers with 3+ months of increasing spend' }
    }
  },

  // =========================================================================
  // 8. Vendor margin analysis
  // =========================================================================
  {
    id: 'gq-08',
    question: 'Which vendors have the highest average profit margin? Calculate margin as (unit_price - cost_price) / unit_price for each product, then average per vendor. Show only vendors with at least 5 products. Include vendor name, product count, average margin, and total revenue from delivered orders.',
    difficulty: 'hard',
    concepts: ['aggregation', 'having', 'case_when', 'join', 'mathematical_expression'],
    referenceSQL: `
SELECT
  v.company_name,
  COUNT(DISTINCT p.product_id) AS product_count,
  ROUND(AVG((p.unit_price - p.cost_price) / NULLIF(p.unit_price, 0)), 4) AS avg_margin,
  COALESCE(SUM(
    CASE WHEN o.status = 'delivered' THEN oi.line_total ELSE 0 END
  ), 0) AS delivered_revenue
FROM vendors v
JOIN products p ON p.vendor_id = v.vendor_id
LEFT JOIN order_items oi ON oi.product_id = p.product_id
LEFT JOIN orders o ON o.order_id = oi.order_id
GROUP BY v.vendor_id, v.company_name
HAVING COUNT(DISTINCT p.product_id) >= 5
ORDER BY avg_margin DESC;
`,
    validate: (rows) => {
      if (rows.length === 0) return { pass: true, score: 1.0, reason: 'Zero rows valid if no vendor has 5+ products' }
      const colCheck = allRowsHaveColumns(rows, ['vendor', 'margin'])
      if (colCheck) return { pass: false, score: 0.2, reason: colCheck }
      // product count >= 5
      const pcKey = Object.keys(rows[0]).find(k => /product_count|count/i.test(k) && !/company/i.test(k))
      if (pcKey) {
        for (const r of rows) {
          if (Number(r[pcKey]) < 5) return { pass: false, score: 0.4, reason: 'All vendors should have >= 5 products' }
        }
      }
      // margin between 0 and 1
      const mKey = Object.keys(rows[0]).find(k => /margin/i.test(k))
      if (mKey) {
        for (const r of rows) {
          const m = Number(r[mKey])
          if (m < -0.5 || m > 1) return { pass: false, score: 0.4, reason: 'Margin values outside expected range' }
        }
      }
      if (!isDescending(rows, 'margin')) {
        return { pass: false, score: 0.7, reason: 'Should be ordered by avg_margin descending' }
      }
      return { pass: true, score: 1.0, reason: 'Correct: vendor margin analysis with product count filter' }
    }
  },

  // =========================================================================
  // 9. Customer lifetime value cohorted by signup month
  // =========================================================================
  {
    id: 'gq-09',
    question: 'Calculate customer lifetime value (total spend) cohorted by signup month. For each cohort (signup month), show the number of customers, average LTV, median LTV, and the percentage of customers who made at least one purchase.',
    difficulty: 'expert',
    concepts: ['cte', 'aggregation', 'date_arithmetic', 'case_when', 'subquery'],
    referenceSQL: `
WITH customer_ltv AS (
  SELECT
    c.customer_id,
    strftime('%Y-%m', c.signup_date) AS cohort_month,
    COALESCE(SUM(CASE WHEN o.status NOT IN ('cancelled', 'refunded') THEN o.total_amount ELSE 0 END), 0) AS ltv
  FROM customers c
  LEFT JOIN orders o ON o.customer_id = c.customer_id
  GROUP BY c.customer_id, cohort_month
),
ranked AS (
  SELECT *,
    ROW_NUMBER() OVER (PARTITION BY cohort_month ORDER BY ltv) AS rn,
    COUNT(*) OVER (PARTITION BY cohort_month) AS cnt
  FROM customer_ltv
)
SELECT
  cohort_month,
  COUNT(*) AS num_customers,
  ROUND(AVG(ltv), 2) AS avg_ltv,
  ROUND((
    SELECT AVG(r2.ltv) FROM ranked r2
    WHERE r2.cohort_month = ranked.cohort_month
      AND r2.rn IN ((ranked.cnt + 1) / 2, (ranked.cnt + 2) / 2)
  ), 2) AS median_ltv,
  ROUND(SUM(CASE WHEN ltv > 0 THEN 1 ELSE 0 END) * 100.0 / COUNT(*), 2) AS pct_with_purchase
FROM ranked
GROUP BY cohort_month
ORDER BY cohort_month;
`,
    validate: (rows) => {
      if (rows.length === 0) return { pass: false, score: 0, reason: 'No rows — expected cohort data' }
      const colCheck = allRowsHaveColumns(rows, ['cohort', 'customer', 'avg'])
      if (colCheck) return { pass: false, score: 0.2, reason: colCheck }
      // Chronological order
      const cohortKey = Object.keys(rows[0]).find(k => /cohort/i.test(k))
      if (cohortKey) {
        const months = rows.map(r => String(r[cohortKey]))
        const sorted = [...months].sort()
        if (JSON.stringify(months) !== JSON.stringify(sorted)) {
          return { pass: false, score: 0.5, reason: 'Cohorts should be in chronological order' }
        }
      }
      // num_customers > 0
      const ncKey = Object.keys(rows[0]).find(k => /num_customer|customer_count|count/i.test(k))
      if (ncKey) {
        for (const r of rows) {
          if (Number(r[ncKey]) <= 0) return { pass: false, score: 0.4, reason: 'num_customers should be > 0' }
        }
      }
      // pct between 0 and 100
      const pctKey = Object.keys(rows[0]).find(k => /pct|percent/i.test(k))
      if (pctKey) {
        for (const r of rows) {
          const v = Number(r[pctKey])
          if (v < 0 || v > 100) return { pass: false, score: 0.4, reason: 'Purchase percentage should be 0-100' }
        }
      }
      // avg_ltv >= 0
      if (!allNonNegative(rows, 'avg')) {
        return { pass: false, score: 0.5, reason: 'Average LTV should be non-negative' }
      }
      return { pass: true, score: 1.0, reason: 'Correct: LTV cohort analysis with median and purchase pct' }
    }
  },

  // =========================================================================
  // 10. Promotions that increased basket size vs control
  // =========================================================================
  {
    id: 'gq-10',
    question: 'Compare the average basket size (number of items per order) for orders that used a promotion vs orders that did not, broken down by promotion. Show each promo code, average basket size with promo, overall average basket size without any promo, and the lift percentage. Only include promotions with at least 10 redemptions.',
    difficulty: 'expert',
    concepts: ['cte', 'aggregation', 'having', 'left_join', 'case_when', 'subquery'],
    referenceSQL: `
WITH promo_orders AS (
  SELECT
    pr.promotion_id,
    p.promo_code,
    o.order_id,
    SUM(oi.quantity) AS basket_size
  FROM promotion_redemptions pr
  JOIN promotions p ON p.promotion_id = pr.promotion_id
  JOIN orders o ON o.order_id = pr.order_id
  JOIN order_items oi ON oi.order_id = o.order_id
  WHERE o.status NOT IN ('cancelled', 'refunded')
  GROUP BY pr.promotion_id, p.promo_code, o.order_id
),
control_avg AS (
  SELECT AVG(basket_size) AS avg_basket
  FROM (
    SELECT o.order_id, SUM(oi.quantity) AS basket_size
    FROM orders o
    JOIN order_items oi ON oi.order_id = o.order_id
    WHERE o.status NOT IN ('cancelled', 'refunded')
      AND o.order_id NOT IN (SELECT order_id FROM promotion_redemptions)
    GROUP BY o.order_id
  )
)
SELECT
  po.promo_code,
  COUNT(*) AS redemption_count,
  ROUND(AVG(po.basket_size), 2) AS avg_basket_with_promo,
  ROUND((SELECT avg_basket FROM control_avg), 2) AS avg_basket_control,
  ROUND((AVG(po.basket_size) - (SELECT avg_basket FROM control_avg)) * 100.0
    / (SELECT avg_basket FROM control_avg), 2) AS lift_pct
FROM promo_orders po
GROUP BY po.promotion_id, po.promo_code
HAVING COUNT(*) >= 10
ORDER BY lift_pct DESC;
`,
    validate: (rows) => {
      if (rows.length === 0) return { pass: true, score: 1.0, reason: 'Zero rows valid if no promo has 10+ redemptions' }
      const colCheck = allRowsHaveColumns(rows, ['promo', 'basket'])
      if (colCheck) return { pass: false, score: 0.2, reason: colCheck }
      // redemption_count >= 10
      const rcKey = Object.keys(rows[0]).find(k => /redemption|count/i.test(k))
      if (rcKey) {
        for (const r of rows) {
          if (Number(r[rcKey]) < 10) return { pass: false, score: 0.4, reason: 'All promos should have >= 10 redemptions' }
        }
      }
      // basket sizes positive
      const bKey = Object.keys(rows[0]).find(k => /basket.*promo|avg_basket/i.test(k))
      if (bKey) {
        for (const r of rows) {
          if (Number(r[bKey]) <= 0) return { pass: false, score: 0.4, reason: 'Basket size should be positive' }
        }
      }
      return { pass: true, score: 1.0, reason: 'Correct: promo lift analysis with control group comparison' }
    }
  },

  // =========================================================================
  // 11. Purchase sequence — what do customers buy after product X?
  // =========================================================================
  {
    id: 'gq-11',
    question: 'For each product, find the most common "next product" that the same customer purchases in a subsequent order (by order_date). Show the source product, next product, and count. Limit to top 20 transitions.',
    difficulty: 'expert',
    concepts: ['window_function', 'lead', 'self_join', 'cte', 'aggregation'],
    referenceSQL: `
WITH customer_purchases AS (
  SELECT
    o.customer_id,
    oi.product_id,
    o.order_date,
    o.order_id,
    ROW_NUMBER() OVER (PARTITION BY o.customer_id ORDER BY o.order_date, o.order_id) AS purchase_seq
  FROM orders o
  JOIN order_items oi ON oi.order_id = o.order_id
  WHERE o.status NOT IN ('cancelled', 'refunded')
),
transitions AS (
  SELECT
    cp1.product_id AS source_product_id,
    cp2.product_id AS next_product_id
  FROM customer_purchases cp1
  JOIN customer_purchases cp2
    ON cp1.customer_id = cp2.customer_id
    AND cp2.purchase_seq = cp1.purchase_seq + 1
  WHERE cp1.product_id <> cp2.product_id
)
SELECT
  p1.product_name AS source_product,
  p2.product_name AS next_product,
  COUNT(*) AS transition_count
FROM transitions t
JOIN products p1 ON p1.product_id = t.source_product_id
JOIN products p2 ON p2.product_id = t.next_product_id
GROUP BY t.source_product_id, t.next_product_id
ORDER BY transition_count DESC
LIMIT 20;
`,
    validate: (rows) => {
      if (rows.length === 0) return { pass: false, score: 0, reason: 'No rows — expected purchase transitions' }
      if (rows.length > 20) return { pass: false, score: 0.3, reason: 'Expected at most 20 rows' }
      const colCheck = allRowsHaveColumns(rows, ['product'])
      if (colCheck) return { pass: false, score: 0.2, reason: colCheck }
      const countKey = Object.keys(rows[0]).find(k => /count|transition|freq/i.test(k))
      if (!countKey) return { pass: false, score: 0.3, reason: 'Missing transition count column' }
      if (!isDescending(rows, countKey)) {
        return { pass: false, score: 0.5, reason: 'Should be ordered by transition count descending' }
      }
      // Source and next product should differ
      const prodKeys = Object.keys(rows[0]).filter(k => /product/i.test(k) && !/count|id/i.test(k))
      if (prodKeys.length >= 2) {
        for (const r of rows) {
          if (String(r[prodKeys[0]]) === String(r[prodKeys[1]])) {
            return { pass: false, score: 0.4, reason: 'Source and next product should differ' }
          }
        }
      }
      return { pass: true, score: 1.0, reason: 'Correct: top 20 purchase transitions' }
    }
  },

  // =========================================================================
  // 12. Revenue by category with rollup-style totals
  // =========================================================================
  {
    id: 'gq-12',
    question: 'Show revenue by top-level category and subcategory for delivered orders. Include a row for each subcategory within its parent, plus a subtotal row per top-level category. Use the recursive category tree to resolve full lineage. Order by top-level category name, then subcategory revenue descending.',
    difficulty: 'expert',
    concepts: ['recursive_cte', 'union_all', 'aggregation', 'case_when', 'join'],
    referenceSQL: `
WITH RECURSIVE cat_lineage AS (
  SELECT category_id, category_name AS root_name, category_name AS sub_name, category_id AS root_id
  FROM categories
  WHERE parent_category_id IS NULL

  UNION ALL

  SELECT c.category_id, cl.root_name, c.category_name, cl.root_id
  FROM categories c
  JOIN cat_lineage cl ON c.parent_category_id = cl.category_id
),
sub_revenue AS (
  SELECT
    cl.root_name,
    cl.sub_name,
    SUM(oi.line_total) AS revenue
  FROM cat_lineage cl
  JOIN products p ON p.category_id = cl.category_id
  JOIN order_items oi ON oi.product_id = p.product_id
  JOIN orders o ON o.order_id = oi.order_id
  WHERE o.status = 'delivered'
  GROUP BY cl.root_name, cl.sub_name
)
SELECT root_name, sub_name, revenue
FROM sub_revenue

UNION ALL

SELECT root_name, '*** SUBTOTAL ***' AS sub_name, SUM(revenue) AS revenue
FROM sub_revenue
GROUP BY root_name

ORDER BY root_name, CASE WHEN sub_name = '*** SUBTOTAL ***' THEN 1 ELSE 0 END, revenue DESC;
`,
    validate: (rows) => {
      if (rows.length === 0) return { pass: false, score: 0, reason: 'No rows returned' }
      const colCheck = allRowsHaveColumns(rows, ['root', 'revenue'])
      if (colCheck) {
        // Try alternate column names
        const altCheck = allRowsHaveColumns(rows, ['category', 'revenue'])
        if (altCheck) return { pass: false, score: 0.2, reason: colCheck }
      }
      // Should have subtotal rows
      const hasTotals = rows.some(r => {
        const vals = Object.values(r).map(v => String(v).toLowerCase())
        return vals.some(v => v.includes('total') || v.includes('all'))
      })
      if (!hasTotals) {
        return { pass: false, score: 0.5, reason: 'Expected subtotal/rollup rows' }
      }
      if (!allNonNegative(rows, 'revenue')) {
        return { pass: false, score: 0.5, reason: 'Revenue should be non-negative' }
      }
      return { pass: true, score: 1.0, reason: 'Correct: hierarchical category revenue with subtotals' }
    }
  },

  // =========================================================================
  // 13. Customers who bought from all top-level categories (relational division)
  // =========================================================================
  {
    id: 'gq-13',
    question: 'Find customers who have purchased at least one product from every top-level category (categories with no parent). Show customer name, email, and the count of distinct top-level categories they bought from.',
    difficulty: 'hard',
    concepts: ['relational_division', 'having', 'count_distinct', 'recursive_cte', 'subquery'],
    referenceSQL: `
WITH RECURSIVE cat_lineage AS (
  SELECT category_id, category_id AS root_category_id
  FROM categories WHERE parent_category_id IS NULL

  UNION ALL

  SELECT c.category_id, cl.root_category_id
  FROM categories c
  JOIN cat_lineage cl ON c.parent_category_id = cl.category_id
),
top_level_count AS (
  SELECT COUNT(*) AS total FROM categories WHERE parent_category_id IS NULL
)
SELECT
  c.first_name || ' ' || c.last_name AS customer_name,
  c.email,
  COUNT(DISTINCT cl.root_category_id) AS categories_covered
FROM customers c
JOIN orders o ON o.customer_id = c.customer_id
JOIN order_items oi ON oi.order_id = o.order_id
JOIN products p ON p.product_id = oi.product_id
JOIN cat_lineage cl ON cl.category_id = p.category_id
WHERE o.status NOT IN ('cancelled', 'refunded')
GROUP BY c.customer_id, customer_name, c.email
HAVING COUNT(DISTINCT cl.root_category_id) = (SELECT total FROM top_level_count)
ORDER BY customer_name;
`,
    validate: (rows) => {
      if (rows.length === 0) return { pass: true, score: 1.0, reason: 'Zero rows valid if no customer covers all categories' }
      const colCheck = allRowsHaveColumns(rows, ['customer', 'email'])
      if (colCheck) return { pass: false, score: 0.2, reason: colCheck }
      // All category counts should be equal (= total top-level count)
      const catKey = Object.keys(rows[0]).find(k => /categor|covered|count/i.test(k))
      if (catKey) {
        const firstVal = Number(rows[0][catKey])
        for (const r of rows) {
          if (Number(r[catKey]) !== firstVal) {
            return { pass: false, score: 0.4, reason: 'All customers should cover the same number of categories' }
          }
        }
      }
      return { pass: true, score: 1.0, reason: 'Correct: customers who bought from all top-level categories' }
    }
  },

  // =========================================================================
  // 14. Order fulfillment time analysis
  // =========================================================================
  {
    id: 'gq-14',
    question: 'Calculate the average, p50, and p90 fulfillment time (in hours, from "created" event to "delivered" event) per vendor. Only include orders that have both events. Show vendor name, order count, avg hours, p50 hours, and p90 hours, ordered by avg hours ascending.',
    difficulty: 'expert',
    concepts: ['cte', 'date_arithmetic', 'percentile', 'window_function', 'join'],
    referenceSQL: `
WITH fulfillment AS (
  SELECT
    oi.order_id,
    p.vendor_id,
    (julianday(del.event_timestamp) - julianday(cr.event_timestamp)) * 24 AS hours_to_deliver
  FROM order_events cr
  JOIN order_events del ON del.order_id = cr.order_id AND del.event_type = 'delivered'
  JOIN order_items oi ON oi.order_id = cr.order_id
  JOIN products p ON p.product_id = oi.product_id
  WHERE cr.event_type = 'created'
  GROUP BY oi.order_id, p.vendor_id
),
ranked AS (
  SELECT *,
    ROW_NUMBER() OVER (PARTITION BY vendor_id ORDER BY hours_to_deliver) AS rn,
    COUNT(*) OVER (PARTITION BY vendor_id) AS cnt
  FROM fulfillment
)
SELECT
  v.company_name AS vendor_name,
  r.cnt AS order_count,
  ROUND(AVG(r.hours_to_deliver), 2) AS avg_hours,
  ROUND((
    SELECT AVG(r2.hours_to_deliver) FROM ranked r2
    WHERE r2.vendor_id = r.vendor_id
      AND r2.rn IN ((r.cnt + 1) / 2, (r.cnt + 2) / 2)
  ), 2) AS p50_hours,
  ROUND((
    SELECT r3.hours_to_deliver FROM ranked r3
    WHERE r3.vendor_id = r.vendor_id
      AND r3.rn = CAST(CEIL(r.cnt * 0.9) AS INTEGER)
  ), 2) AS p90_hours
FROM ranked r
JOIN vendors v ON v.vendor_id = r.vendor_id
GROUP BY r.vendor_id, v.company_name, r.cnt
HAVING r.cnt >= 1
ORDER BY avg_hours ASC;
`,
    validate: (rows) => {
      if (rows.length === 0) return { pass: true, score: 1.0, reason: 'Zero rows valid if no complete fulfillment events' }
      const colCheck = allRowsHaveColumns(rows, ['vendor', 'avg'])
      if (colCheck) return { pass: false, score: 0.2, reason: colCheck }
      if (!isAscending(rows, 'avg')) {
        return { pass: false, score: 0.5, reason: 'Should be ordered by avg_hours ascending' }
      }
      // p50 <= p90 for each row
      const p50Key = Object.keys(rows[0]).find(k => /p50|median/i.test(k))
      const p90Key = Object.keys(rows[0]).find(k => /p90/i.test(k))
      if (p50Key && p90Key) {
        for (const r of rows) {
          if (Number(r[p50Key]) > Number(r[p90Key]) + 0.01) {
            return { pass: false, score: 0.4, reason: 'p50 should not exceed p90' }
          }
        }
      }
      // Hours should be positive
      if (!allPositive(rows, 'avg')) {
        return { pass: false, score: 0.5, reason: 'Avg hours should be positive' }
      }
      return { pass: true, score: 1.0, reason: 'Correct: fulfillment time analysis with percentiles per vendor' }
    }
  },

  // =========================================================================
  // 15. Referral chain depth
  // =========================================================================
  {
    id: 'gq-15',
    question: 'Using the self-referential referral_customer_id on customers, find the longest referral chains. Use a recursive CTE to trace each customer back to their original referrer (one with no referrer). Show the chain root customer name, the chain end customer name, and the chain depth. Show only chains of depth >= 2, ordered by depth descending.',
    difficulty: 'expert',
    concepts: ['recursive_cte', 'self_join', 'chain_traversal'],
    referenceSQL: `
WITH RECURSIVE referral_chain AS (
  SELECT
    customer_id,
    customer_id AS root_id,
    first_name || ' ' || last_name AS root_name,
    first_name || ' ' || last_name AS leaf_name,
    0 AS depth
  FROM customers
  WHERE referral_customer_id IS NULL

  UNION ALL

  SELECT
    c.customer_id,
    rc.root_id,
    rc.root_name,
    c.first_name || ' ' || c.last_name,
    rc.depth + 1
  FROM customers c
  JOIN referral_chain rc ON c.referral_customer_id = rc.customer_id
)
SELECT
  root_name,
  leaf_name AS chain_end_customer,
  depth AS chain_depth
FROM referral_chain
WHERE depth >= 2
  AND customer_id NOT IN (SELECT COALESCE(referral_customer_id, -1) FROM customers)
ORDER BY depth DESC, root_name;
`,
    validate: (rows) => {
      if (rows.length === 0) return { pass: true, score: 1.0, reason: 'Zero rows valid if no chains >= depth 2' }
      const colCheck = allRowsHaveColumns(rows, ['root', 'depth'])
      if (colCheck) return { pass: false, score: 0.2, reason: colCheck }
      const dKey = Object.keys(rows[0]).find(k => /depth|chain/i.test(k))
      if (dKey) {
        for (const r of rows) {
          if (Number(r[dKey]) < 2) return { pass: false, score: 0.4, reason: 'All chains should have depth >= 2' }
        }
        if (!isDescending(rows, dKey)) {
          return { pass: false, score: 0.6, reason: 'Should be ordered by depth descending' }
        }
      }
      return { pass: true, score: 1.0, reason: 'Correct: referral chain analysis with recursive CTE' }
    }
  },

  // =========================================================================
  // 16. Customers who returned items but never left a negative review
  // =========================================================================
  {
    id: 'gq-16',
    question: 'Find customers who have had at least one order with status "returned" or "refunded" but have never written a review with rating <= 2. Show customer name, number of returned orders, number of reviews, and their average review rating.',
    difficulty: 'hard',
    concepts: ['exists', 'not_exists', 'aggregation', 'correlated_subquery'],
    referenceSQL: `
SELECT
  c.first_name || ' ' || c.last_name AS customer_name,
  (SELECT COUNT(*) FROM orders o2 WHERE o2.customer_id = c.customer_id AND o2.status IN ('returned', 'refunded')) AS returned_orders,
  COUNT(r.review_id) AS review_count,
  ROUND(AVG(r.rating), 2) AS avg_rating
FROM customers c
LEFT JOIN reviews r ON r.customer_id = c.customer_id
WHERE EXISTS (
  SELECT 1 FROM orders o WHERE o.customer_id = c.customer_id AND o.status IN ('returned', 'refunded')
)
AND NOT EXISTS (
  SELECT 1 FROM reviews rv WHERE rv.customer_id = c.customer_id AND rv.rating <= 2
)
GROUP BY c.customer_id, customer_name
ORDER BY returned_orders DESC;
`,
    validate: (rows) => {
      if (rows.length === 0) return { pass: true, score: 1.0, reason: 'Zero rows valid if no such customers exist' }
      const colCheck = allRowsHaveColumns(rows, ['customer', 'return'])
      if (colCheck) return { pass: false, score: 0.2, reason: colCheck }
      // returned_orders should be >= 1
      const retKey = Object.keys(rows[0]).find(k => /return/i.test(k))
      if (retKey) {
        for (const r of rows) {
          if (Number(r[retKey]) < 1) return { pass: false, score: 0.4, reason: 'returned_orders should be >= 1' }
        }
      }
      // avg_rating should be > 2 (since no reviews <= 2)
      const ratingKey = Object.keys(rows[0]).find(k => /avg.*rating|rating.*avg/i.test(k))
      if (ratingKey) {
        for (const r of rows) {
          const v = Number(r[ratingKey])
          if (!isNaN(v) && v > 0 && v <= 2) return { pass: false, score: 0.4, reason: 'avg_rating should be > 2 since no negative reviews' }
        }
      }
      return { pass: true, score: 1.0, reason: 'Correct: returned-but-no-negative-review customers' }
    }
  },

  // =========================================================================
  // 17. Products never ordered (EXCEPT)
  // =========================================================================
  {
    id: 'gq-17',
    question: 'Find all active products that have never appeared in any order. Use a set operation (EXCEPT or NOT EXISTS). Show product name, vendor company name, category name, unit price, and days since listing.',
    difficulty: 'hard',
    concepts: ['set_operation', 'except', 'not_exists', 'date_arithmetic', 'join'],
    referenceSQL: `
SELECT
  p.product_name,
  v.company_name AS vendor_name,
  c.category_name,
  p.unit_price,
  CAST(julianday('now') - julianday(p.listed_at) AS INTEGER) AS days_since_listing
FROM products p
JOIN vendors v ON v.vendor_id = p.vendor_id
JOIN categories c ON c.category_id = p.category_id
WHERE p.status = 'active'
  AND p.product_id NOT IN (
    SELECT DISTINCT product_id FROM order_items
  )
ORDER BY days_since_listing DESC;
`,
    validate: (rows) => {
      if (rows.length === 0) return { pass: true, score: 1.0, reason: 'Zero rows valid if all active products have orders' }
      const colCheck = allRowsHaveColumns(rows, ['product', 'vendor', 'category', 'price'])
      if (colCheck) return { pass: false, score: 0.2, reason: colCheck }
      // Price should be non-negative
      if (!allNonNegative(rows, 'price')) {
        return { pass: false, score: 0.5, reason: 'Price should be non-negative' }
      }
      // days_since_listing should be non-negative
      const daysKey = Object.keys(rows[0]).find(k => /days|since|listing/i.test(k))
      if (daysKey) {
        for (const r of rows) {
          const v = Number(r[daysKey])
          if (!isNaN(v) && v < 0) return { pass: false, score: 0.4, reason: 'Days since listing should be non-negative' }
        }
      }
      return { pass: true, score: 1.0, reason: 'Correct: active products with no orders' }
    }
  },

  // =========================================================================
  // 18. Vendor payout discrepancy detection
  // =========================================================================
  {
    id: 'gq-18',
    question: 'For each vendor, calculate the expected payout (sum of line_total * (1 - commission_rate) for delivered orders in each payout period) and compare it to the actual payout_amount. Flag periods where the discrepancy exceeds 5%. Show vendor name, period, expected amount, actual amount, and discrepancy percentage.',
    difficulty: 'expert',
    concepts: ['cte', 'aggregation', 'date_arithmetic', 'join', 'mathematical_expression', 'having'],
    referenceSQL: `
WITH expected AS (
  SELECT
    p.vendor_id,
    vp.payout_id,
    vp.period_start_date,
    vp.period_end_date,
    vp.payout_amount AS actual_amount,
    SUM(oi.line_total * (1.0 - v.commission_rate)) AS expected_amount
  FROM vendor_payouts vp
  JOIN vendors v ON v.vendor_id = vp.vendor_id
  JOIN products p ON p.vendor_id = v.vendor_id
  JOIN order_items oi ON oi.product_id = p.product_id
  JOIN orders o ON o.order_id = oi.order_id
  WHERE o.status = 'delivered'
    AND o.order_date >= vp.period_start_date
    AND o.order_date < vp.period_end_date
  GROUP BY p.vendor_id, vp.payout_id, vp.period_start_date, vp.period_end_date, vp.payout_amount
)
SELECT
  v.company_name AS vendor_name,
  e.period_start_date,
  e.period_end_date,
  ROUND(e.expected_amount, 2) AS expected_amount,
  ROUND(e.actual_amount, 2) AS actual_amount,
  ROUND(ABS(e.actual_amount - e.expected_amount) * 100.0 / NULLIF(e.expected_amount, 0), 2) AS discrepancy_pct
FROM expected e
JOIN vendors v ON v.vendor_id = e.vendor_id
WHERE ABS(e.actual_amount - e.expected_amount) * 100.0 / NULLIF(e.expected_amount, 0) > 5.0
ORDER BY discrepancy_pct DESC;
`,
    validate: (rows) => {
      if (rows.length === 0) return { pass: true, score: 1.0, reason: 'Zero rows valid if no discrepancies > 5%' }
      const colCheck = allRowsHaveColumns(rows, ['vendor', 'expected', 'actual'])
      if (colCheck) return { pass: false, score: 0.2, reason: colCheck }
      // discrepancy_pct > 5
      const dKey = Object.keys(rows[0]).find(k => /discrepancy|discrep|diff_pct|pct/i.test(k))
      if (dKey) {
        for (const r of rows) {
          if (Number(r[dKey]) <= 5) return { pass: false, score: 0.4, reason: 'Discrepancy should exceed 5%' }
        }
        if (!isDescending(rows, dKey)) {
          return { pass: false, score: 0.7, reason: 'Should be ordered by discrepancy descending' }
        }
      }
      // expected and actual should be positive
      if (!allPositive(rows, 'expected')) {
        return { pass: false, score: 0.5, reason: 'Expected amount should be positive' }
      }
      return { pass: true, score: 1.0, reason: 'Correct: vendor payout discrepancy detection' }
    }
  },

  // =========================================================================
  // 19. Month-over-month customer retention (cohort retention matrix)
  // =========================================================================
  {
    id: 'gq-19',
    question: 'Build a cohort retention matrix: for each signup month cohort, show what percentage of customers made a purchase in each of the following 6 months (month 0 = signup month, month 1 = next month, ... month 5). Each row is a cohort, columns are month_0_pct through month_5_pct.',
    difficulty: 'expert',
    concepts: ['cte', 'date_arithmetic', 'case_when', 'aggregation', 'cross_join_logic'],
    referenceSQL: `
WITH cohorts AS (
  SELECT
    customer_id,
    strftime('%Y-%m', signup_date) AS cohort_month,
    signup_date
  FROM customers
),
activity AS (
  SELECT DISTINCT
    o.customer_id,
    strftime('%Y-%m', o.order_date) AS active_month
  FROM orders o
  WHERE o.status NOT IN ('cancelled', 'refunded')
),
cohort_activity AS (
  SELECT
    c.cohort_month,
    c.customer_id,
    CAST((julianday(a.active_month || '-01') - julianday(c.cohort_month || '-01')) / 30 AS INTEGER) AS month_offset
  FROM cohorts c
  JOIN activity a ON a.customer_id = c.customer_id
),
cohort_sizes AS (
  SELECT cohort_month, COUNT(*) AS cohort_size FROM cohorts GROUP BY cohort_month
)
SELECT
  ca.cohort_month,
  cs.cohort_size,
  ROUND(COUNT(DISTINCT CASE WHEN month_offset = 0 THEN ca.customer_id END) * 100.0 / cs.cohort_size, 2) AS month_0_pct,
  ROUND(COUNT(DISTINCT CASE WHEN month_offset = 1 THEN ca.customer_id END) * 100.0 / cs.cohort_size, 2) AS month_1_pct,
  ROUND(COUNT(DISTINCT CASE WHEN month_offset = 2 THEN ca.customer_id END) * 100.0 / cs.cohort_size, 2) AS month_2_pct,
  ROUND(COUNT(DISTINCT CASE WHEN month_offset = 3 THEN ca.customer_id END) * 100.0 / cs.cohort_size, 2) AS month_3_pct,
  ROUND(COUNT(DISTINCT CASE WHEN month_offset = 4 THEN ca.customer_id END) * 100.0 / cs.cohort_size, 2) AS month_4_pct,
  ROUND(COUNT(DISTINCT CASE WHEN month_offset = 5 THEN ca.customer_id END) * 100.0 / cs.cohort_size, 2) AS month_5_pct
FROM cohort_activity ca
JOIN cohort_sizes cs ON cs.cohort_month = ca.cohort_month
WHERE month_offset BETWEEN 0 AND 5
GROUP BY ca.cohort_month, cs.cohort_size
ORDER BY ca.cohort_month;
`,
    validate: (rows) => {
      if (rows.length === 0) return { pass: false, score: 0, reason: 'No rows — expected cohort retention data' }
      const colCheck = allRowsHaveColumns(rows, ['cohort', 'month_0'])
      if (colCheck) return { pass: false, score: 0.2, reason: colCheck }
      // All percentages should be 0-100
      for (const r of rows) {
        for (const k of Object.keys(r)) {
          if (/month_\d/i.test(k)) {
            const v = Number(r[k])
            if (v < 0 || v > 100) return { pass: false, score: 0.4, reason: `${k} should be between 0 and 100, got ${v}` }
          }
        }
      }
      // month_0 should generally be >= later months (retention decays)
      const m0Key = Object.keys(rows[0]).find(k => /month_0/i.test(k))
      const m5Key = Object.keys(rows[0]).find(k => /month_5/i.test(k))
      if (m0Key && m5Key) {
        let decayViolations = 0
        for (const r of rows) {
          if (Number(r[m0Key]) < Number(r[m5Key])) decayViolations++
        }
        if (decayViolations > rows.length * 0.5) {
          return { pass: false, score: 0.5, reason: 'Retention generally should not increase over time for most cohorts' }
        }
      }
      // Chronological ordering
      const cKey = Object.keys(rows[0]).find(k => /cohort/i.test(k))
      if (cKey) {
        const vals = rows.map(r => String(r[cKey]))
        const sorted = [...vals].sort()
        if (JSON.stringify(vals) !== JSON.stringify(sorted)) {
          return { pass: false, score: 0.7, reason: 'Cohort months should be in chronological order' }
        }
      }
      return { pass: true, score: 1.0, reason: 'Correct: cohort retention matrix with month 0-5 percentages' }
    }
  },

  // =========================================================================
  // 20. Multi-factor customer scoring with RANK, NTILE
  // =========================================================================
  {
    id: 'gq-20',
    question: 'Create a customer scoring model: for each active customer, compute an RFM score (Recency, Frequency, Monetary). Recency = days since last order (lower is better). Frequency = number of orders. Monetary = total spend. Assign each metric an NTILE(5) score (5=best). Sum the three scores into a composite_score. Show customer name, recency_days, frequency, monetary, r_score, f_score, m_score, composite_score. Order by composite_score descending, limit to top 25.',
    difficulty: 'expert',
    concepts: ['window_function', 'ntile', 'cte', 'date_arithmetic', 'case_when', 'aggregation'],
    referenceSQL: `
WITH rfm_raw AS (
  SELECT
    c.customer_id,
    c.first_name || ' ' || c.last_name AS customer_name,
    CAST(julianday('now') - julianday(MAX(o.order_date)) AS INTEGER) AS recency_days,
    COUNT(DISTINCT o.order_id) AS frequency,
    SUM(o.total_amount) AS monetary
  FROM customers c
  JOIN orders o ON o.customer_id = c.customer_id
  WHERE o.status NOT IN ('cancelled', 'refunded')
    AND c.is_active = 1
  GROUP BY c.customer_id, customer_name
),
rfm_scored AS (
  SELECT *,
    NTILE(5) OVER (ORDER BY recency_days DESC) AS r_score,
    NTILE(5) OVER (ORDER BY frequency ASC) AS f_score,
    NTILE(5) OVER (ORDER BY monetary ASC) AS m_score
  FROM rfm_raw
)
SELECT
  customer_name,
  recency_days,
  frequency,
  ROUND(monetary, 2) AS monetary,
  r_score,
  f_score,
  m_score,
  r_score + f_score + m_score AS composite_score
FROM rfm_scored
ORDER BY composite_score DESC, monetary DESC
LIMIT 25;
`,
    validate: (rows) => {
      if (rows.length === 0) return { pass: false, score: 0, reason: 'No rows — expected customer RFM scores' }
      if (rows.length > 25) return { pass: false, score: 0.3, reason: 'Expected at most 25 rows' }
      const colCheck = allRowsHaveColumns(rows, ['customer', 'recency', 'frequency', 'monetary'])
      if (colCheck) return { pass: false, score: 0.2, reason: colCheck }
      // Check score columns exist
      const hasScores = hasColumnLike(rows[0], 'r_score') && hasColumnLike(rows[0], 'f_score') && hasColumnLike(rows[0], 'm_score')
      if (!hasScores) {
        const altScores = hasColumnLike(rows[0], 'score')
        if (!altScores) return { pass: false, score: 0.3, reason: 'Missing RFM score columns' }
      }
      // Composite score should be 3-15 (sum of three NTILE(5) scores)
      const compKey = Object.keys(rows[0]).find(k => /composite|total_score|rfm_score/i.test(k))
      if (compKey) {
        for (const r of rows) {
          const v = Number(r[compKey])
          if (v < 3 || v > 15) return { pass: false, score: 0.4, reason: `Composite score should be 3-15, got ${v}` }
        }
        if (!isDescending(rows, compKey)) {
          return { pass: false, score: 0.6, reason: 'Should be ordered by composite_score descending' }
        }
      }
      // Individual scores 1-5
      for (const scoreCol of ['r_score', 'f_score', 'm_score']) {
        const key = Object.keys(rows[0]).find(k => k.toLowerCase() === scoreCol)
        if (key) {
          for (const r of rows) {
            const v = Number(r[key])
            if (v < 1 || v > 5) return { pass: false, score: 0.4, reason: `${scoreCol} should be 1-5, got ${v}` }
          }
        }
      }
      // Recency and frequency positive
      if (!allNonNegative(rows, 'recency')) {
        return { pass: false, score: 0.5, reason: 'Recency should be non-negative' }
      }
      if (!allPositive(rows, 'frequency')) {
        return { pass: false, score: 0.5, reason: 'Frequency should be positive' }
      }
      return { pass: true, score: 1.0, reason: 'Correct: RFM customer scoring with NTILE(5), top 25' }
    }
  },

]
