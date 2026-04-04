import { getDb } from './db'
import { BENCHMARK_DDL_PROMPT } from './schemas/benchmark'

// ---------------------------------------------------------------------------
// Deterministic pseudo-random (seeded for reproducibility)
// ---------------------------------------------------------------------------
let _seed = 42
function rand(): number {
  _seed = (_seed * 16807 + 0) % 2147483647
  return (_seed & 0x7fffffff) / 0x7fffffff
}
function randInt(min: number, max: number): number {
  return Math.floor(rand() * (max - min + 1)) + min
}
function pick<T>(arr: T[]): T {
  return arr[randInt(0, arr.length - 1)]
}
function pickN<T>(arr: T[], n: number): T[] {
  const shuffled = [...arr].sort(() => rand() - 0.5)
  return shuffled.slice(0, Math.min(n, shuffled.length))
}
function dateBetween(startDaysAgo: number, endDaysAgo: number): string {
  const now = Date.now()
  const ms = now - randInt(endDaysAgo, startDaysAgo) * 86400000
  return new Date(ms).toISOString().slice(0, 10)
}
function datetimeBetween(startDaysAgo: number, endDaysAgo: number): string {
  const now = Date.now()
  const ms = now - randInt(endDaysAgo, startDaysAgo) * 86400000 - randInt(0, 86400) * 1000
  return new Date(ms).toISOString().replace('T', ' ').slice(0, 19)
}
function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr)
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}
function addDaysDatetime(dateStr: string, days: number): string {
  const d = new Date(dateStr + 'T12:00:00Z')
  d.setDate(d.getDate() + days)
  d.setHours(d.getHours() + randInt(0, 12))
  return d.toISOString().replace('T', ' ').slice(0, 19)
}

// ---------------------------------------------------------------------------
// Data constants
// ---------------------------------------------------------------------------
const FIRST_NAMES = [
  'James', 'Mary', 'Robert', 'Patricia', 'John', 'Jennifer', 'Michael', 'Linda',
  'David', 'Elizabeth', 'William', 'Barbara', 'Richard', 'Susan', 'Joseph', 'Jessica',
  'Thomas', 'Sarah', 'Charles', 'Karen', 'Chris', 'Lisa', 'Daniel', 'Nancy',
  'Matthew', 'Betty', 'Anthony', 'Margaret', 'Mark', 'Sandra', 'Donald', 'Ashley',
  'Steven', 'Dorothy', 'Andrew', 'Kimberly', 'Paul', 'Emily', 'Joshua', 'Donna',
  'Kenneth', 'Michelle', 'Kevin', 'Carol', 'Brian', 'Amanda', 'George', 'Melissa',
  'Timothy', 'Deborah',
]

const LAST_NAMES = [
  'Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Garcia', 'Miller', 'Davis',
  'Rodriguez', 'Martinez', 'Hernandez', 'Lopez', 'Gonzalez', 'Wilson', 'Anderson',
  'Thomas', 'Taylor', 'Moore', 'Jackson', 'Martin', 'Lee', 'Perez', 'Thompson',
  'White', 'Harris', 'Sanchez', 'Clark', 'Ramirez', 'Lewis', 'Robinson',
  'Walker', 'Young', 'Allen', 'King', 'Wright', 'Scott', 'Torres', 'Nguyen',
  'Hill', 'Flores',
]

const CITIES = [
  'New York', 'Los Angeles', 'Chicago', 'Houston', 'Phoenix', 'Philadelphia',
  'San Antonio', 'San Diego', 'Dallas', 'San Jose', 'Austin', 'Jacksonville',
  'Fort Worth', 'Columbus', 'Charlotte', 'Indianapolis', 'San Francisco', 'Seattle',
  'Denver', 'Nashville',
]

const STATES = [
  'NY', 'CA', 'IL', 'TX', 'AZ', 'PA', 'TX', 'CA', 'TX', 'CA',
  'TX', 'FL', 'TX', 'OH', 'NC', 'IN', 'CA', 'WA', 'CO', 'TN',
]

const STREETS = [
  'Main St', 'Oak Ave', 'Pine Rd', 'Elm St', 'Cedar Blvd', 'Maple Dr',
  'Washington St', 'Park Ave', 'Lake St', 'Hill Rd', 'River Ln', 'Forest Dr',
  'Sunset Blvd', 'Valley Rd', 'Spring St', 'Highland Ave', 'Church St', 'Mill Rd',
]

const GENDERS: Array<'male' | 'female' | 'non_binary' | 'prefer_not_to_say'> = ['male', 'female', 'non_binary', 'prefer_not_to_say']

const PAYMENT_METHODS: string[] = ['credit_card', 'debit_card', 'paypal', 'bank_transfer', 'crypto', 'gift_card']

const ROOT_CATEGORIES = ['Electronics', 'Clothing', 'Food & Beverage', 'Sports & Outdoors', 'Home & Garden']

const SUB_CATEGORIES: Record<string, string[]> = {
  'Electronics': ['Computers', 'Mobile Devices', 'Audio & Video'],
  'Clothing': ['Mens Wear', 'Womens Wear', 'Accessories'],
  'Food & Beverage': ['Snacks', 'Beverages', 'Organic Foods'],
  'Sports & Outdoors': ['Fitness Equipment', 'Outdoor Gear', 'Team Sports'],
  'Home & Garden': ['Furniture', 'Kitchen', 'Garden Tools'],
}

const LEAF_CATEGORIES: Record<string, string[]> = {
  'Computers': ['Laptops', 'Desktops'],
  'Mobile Devices': ['Smartphones', 'Tablets'],
  'Audio & Video': ['Headphones', 'Speakers'],
  'Mens Wear': ['Shirts', 'Pants'],
  'Womens Wear': ['Dresses', 'Tops'],
  'Accessories': ['Watches', 'Bags'],
  'Snacks': ['Chips', 'Nuts'],
  'Beverages': ['Coffee', 'Tea'],
  'Organic Foods': ['Fruits', 'Vegetables'],
  'Fitness Equipment': ['Weights', 'Yoga Mats'],
  'Outdoor Gear': ['Tents', 'Backpacks'],
  'Team Sports': ['Footballs', 'Basketballs'],
  'Furniture': ['Sofas', 'Tables'],
  'Kitchen': ['Cookware', 'Utensils'],
  'Garden Tools': ['Mowers', 'Trimmers'],
}

const VENDOR_NAMES = [
  'TechVault Inc', 'GreenLeaf Supplies', 'Urban Style Co', 'FreshMart Direct',
  'SportsPeak Ltd', 'HomeHaven Group', 'NexGen Electronics', 'Artisan Goods Co',
  'Pacific Trade LLC', 'Summit Brands', 'BlueWave Retail', 'CraftWorks Studio',
]

const PRODUCT_ADJECTIVES = ['Premium', 'Classic', 'Ultra', 'Pro', 'Essential', 'Deluxe', 'Eco', 'Smart']

const TAG_NAMES = [
  'new-arrival', 'bestseller', 'eco-friendly', 'premium', 'sale',
  'bundle', 'limited-edition', 'organic', 'handmade', 'imported',
  'trending', 'clearance', 'seasonal', 'exclusive', 'value-pack',
  'gift-ready', 'top-rated', 'staff-pick', 'back-in-stock', 'pre-order',
]

const PROMO_CODES = [
  { code: 'SAVE10', desc: '10% off your order', type: 'percentage' as const, value: 10, minOrder: 25 },
  { code: 'FLAT20', desc: '$20 off orders over $100', type: 'fixed_amount' as const, value: 20, minOrder: 100 },
  { code: 'FREESHIP', desc: 'Free shipping on all orders', type: 'free_shipping' as const, value: 0, minOrder: 0 },
  { code: 'SUMMER25', desc: '25% off summer sale', type: 'percentage' as const, value: 25, minOrder: 50 },
  { code: 'WELCOME15', desc: '15% off first order', type: 'percentage' as const, value: 15, minOrder: 0 },
  { code: 'BOGO50', desc: 'Buy one get one 50% off', type: 'buy_x_get_y' as const, value: 50, minOrder: 0 },
  { code: 'HOLIDAY30', desc: '30% off holiday special', type: 'percentage' as const, value: 30, minOrder: 75 },
  { code: 'FLAT5', desc: '$5 off any order', type: 'fixed_amount' as const, value: 5, minOrder: 15 },
]

// ---------------------------------------------------------------------------
// slugify
// ---------------------------------------------------------------------------
function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
}

// ---------------------------------------------------------------------------
// Main seeder
// ---------------------------------------------------------------------------
export function seedBenchmarkDb(): { seeded: boolean; tables: { name: string; rows: number }[] } {
  _seed = 42 // reset for reproducibility
  const db = getDb()

  // Check if already seeded
  try {
    const count = (db.prepare("SELECT COUNT(*) as n FROM customers").get() as { n: number }).n
    if (count > 0) {
      const tables = getTableCounts(db)
      return { seeded: false, tables }
    }
  } catch {
    // Table doesn't exist yet — proceed with seeding
  }

  // Execute DDL
  const ddlStatements = extractDDL(BENCHMARK_DDL_PROMPT)
  db.exec('PRAGMA foreign_keys = OFF;')
  for (const stmt of ddlStatements) {
    try {
      db.exec(stmt)
    } catch {
      // ignore errors from already-existing tables
    }
  }
  db.exec('PRAGMA foreign_keys = ON;')

  // Seed in a transaction for performance
  const seedAll = db.transaction(() => {
    seedCategories(db)
    seedVendors(db)
    seedCustomers(db)
    seedCustomerAddresses(db)
    seedProducts(db)
    seedTags(db)
    seedProductTags(db)
    seedPromotions(db)
    seedOrders(db)
    seedOrderItems(db)
    seedOrderEvents(db)
    seedReviews(db)
    seedPromotionRedemptions(db)
    seedInventoryLogs(db)
    seedVendorPayouts(db)
    updateLifetimeSpend(db)
  })

  seedAll()

  const tables = getTableCounts(db)
  return { seeded: true, tables }
}

function extractDDL(prompt: string): string[] {
  const lines = prompt.split('\n')
  const statements: string[] = []
  let current = ''
  for (const line of lines) {
    const trimmed = line.trim()
    if (trimmed.startsWith('--') || trimmed === '') continue
    if (trimmed.startsWith('Create this') || trimmed.startsWith('Output ONLY')) continue
    current += line + '\n'
    if (trimmed.endsWith(';')) {
      const stmt = current.trim()
      if (stmt.length > 1) statements.push(stmt)
      current = ''
    }
  }
  if (current.trim().length > 1) statements.push(current.trim())
  return statements
}

function getTableCounts(db: ReturnType<typeof getDb>): { name: string; rows: number }[] {
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as { name: string }[]
  return tables.map(t => {
    try {
      const count = (db.prepare(`SELECT COUNT(*) as n FROM "${t.name}"`).get() as { n: number }).n
      return { name: t.name, rows: count }
    } catch {
      return { name: t.name, rows: 0 }
    }
  })
}

// ---------------------------------------------------------------------------
// Seeders
// ---------------------------------------------------------------------------

function seedCategories(db: ReturnType<typeof getDb>) {
  const insert = db.prepare(`INSERT INTO categories (category_id, parent_category_id, category_name, slug, depth_level, is_active, sort_order) VALUES (?, ?, ?, ?, ?, 1, ?)`)
  let id = 1

  // Root categories (depth 0)
  const rootIds: Record<string, number> = {}
  for (let i = 0; i < ROOT_CATEGORIES.length; i++) {
    const name = ROOT_CATEGORIES[i]
    rootIds[name] = id
    insert.run(id, null, name, slugify(name), 0, i)
    id++
  }

  // Subcategories (depth 1)
  const subIds: Record<string, number> = {}
  for (const root of ROOT_CATEGORIES) {
    const subs = SUB_CATEGORIES[root]
    for (let i = 0; i < subs.length; i++) {
      subIds[subs[i]] = id
      insert.run(id, rootIds[root], subs[i], slugify(subs[i]), 1, i)
      id++
    }
  }

  // Leaf categories (depth 2)
  for (const sub of Object.keys(LEAF_CATEGORIES)) {
    const leaves = LEAF_CATEGORIES[sub]
    for (let i = 0; i < leaves.length; i++) {
      insert.run(id, subIds[sub], leaves[i], slugify(leaves[i]), 2, i)
      id++
    }
  }
}

function seedVendors(db: ReturnType<typeof getDb>) {
  const insert = db.prepare(`INSERT INTO vendors (vendor_id, company_name, contact_email, contact_phone, country_code, commission_rate, rating_avg, status, onboarded_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?)`)
  const countries = ['US', 'US', 'US', 'CA', 'GB', 'DE', 'US', 'US', 'JP', 'US', 'AU', 'US']
  const commissions = [0.08, 0.10, 0.12, 0.15, 0.18, 0.20, 0.09, 0.14, 0.22, 0.11, 0.25, 0.16]

  for (let i = 0; i < VENDOR_NAMES.length; i++) {
    const name = VENDOR_NAMES[i]
    const email = slugify(name) + '@example.com'
    const phone = `+1-555-${String(1000 + i).padStart(4, '0')}`
    const rating = Math.round((3.0 + rand() * 2.0) * 10) / 10
    const onboarded = dateBetween(730, 180)
    insert.run(i + 1, name, email, phone, countries[i], commissions[i], rating, onboarded)
  }
}

function seedCustomers(db: ReturnType<typeof getDb>) {
  const insert = db.prepare(`INSERT INTO customers (customer_id, email, first_name, last_name, phone, signup_date, birth_date, gender, tier, is_active, referral_customer_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)

  const tiers: string[] = []
  // 60% bronze, 25% silver, 10% gold, 5% platinum
  for (let i = 0; i < 200; i++) {
    if (i < 120) tiers.push('bronze')
    else if (i < 170) tiers.push('silver')
    else if (i < 190) tiers.push('gold')
    else tiers.push('platinum')
  }
  // shuffle
  tiers.sort(() => rand() - 0.5)

  for (let i = 1; i <= 200; i++) {
    const first = pick(FIRST_NAMES)
    const last = pick(LAST_NAMES)
    const email = `${first.toLowerCase()}.${last.toLowerCase()}${i}@example.com`
    const phone = `+1-555-${String(2000 + i).padStart(4, '0')}`
    const signupDate = dateBetween(730, 1)
    const birthYear = randInt(1960, 2003)
    const birthDate = `${birthYear}-${String(randInt(1, 12)).padStart(2, '0')}-${String(randInt(1, 28)).padStart(2, '0')}`
    const gender = pick(GENDERS)
    const tier = tiers[i - 1]
    const isActive = rand() > 0.05 ? 1 : 0
    // 30 customers get referrals pointing to earlier customers
    let referralId: number | null = null
    if (i > 10 && i <= 40) {
      referralId = randInt(1, i - 1)
    }
    insert.run(i, email, first, last, phone, signupDate, birthDate, gender, tier, isActive, referralId)
  }
}

function seedCustomerAddresses(db: ReturnType<typeof getDb>) {
  const insert = db.prepare(`INSERT INTO customer_addresses (customer_id, label, street_line1, city, state_province, postal_code, country_code, is_default) VALUES (?, ?, ?, ?, ?, ?, 'US', ?)`)

  for (let cid = 1; cid <= 200; cid++) {
    const numAddresses = rand() > 0.4 ? 2 : 1
    const labels: Array<'home' | 'work'> = ['home', 'work']
    for (let a = 0; a < numAddresses; a++) {
      const streetNum = randInt(100, 9999)
      const street = `${streetNum} ${pick(STREETS)}`
      const cityIdx = randInt(0, CITIES.length - 1)
      const postal = String(randInt(10000, 99999))
      insert.run(cid, labels[a], street, CITIES[cityIdx], STATES[cityIdx], postal, a === 0 ? 1 : 0)
    }
  }
}

function seedProducts(db: ReturnType<typeof getDb>) {
  // Get leaf category IDs (depth_level = 2)
  const db2 = getDb()
  const leafCats = db2.prepare("SELECT category_id FROM categories WHERE depth_level = 2").all() as { category_id: number }[]
  const leafIds = leafCats.map(c => c.category_id)

  const insert = db.prepare(`INSERT INTO products (product_id, vendor_id, category_id, sku, product_name, description, unit_price, cost_price, weight_kg, stock_quantity, reorder_level, status, listed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?)`)

  for (let i = 1; i <= 80; i++) {
    const vendorId = ((i - 1) % 12) + 1
    const catId = leafIds[(i - 1) % leafIds.length]
    const sku = `SKU-${String(i).padStart(4, '0')}`
    const adj = pick(PRODUCT_ADJECTIVES)
    const productName = `${adj} Product ${i}`
    const desc = `High-quality ${adj.toLowerCase()} product for everyday use.`
    const unitPrice = Math.round((10 + rand() * 490) * 100) / 100
    const costPrice = Math.round(unitPrice * (0.3 + rand() * 0.4) * 100) / 100
    const weight = Math.round((0.1 + rand() * 20) * 10) / 10
    const stock = randInt(5, 500)
    const reorder = randInt(5, 50)
    const listedAt = dateBetween(365, 30)
    insert.run(i, vendorId, catId, sku, productName, desc, unitPrice, costPrice, weight, stock, reorder, listedAt)
  }
}

function seedTags(db: ReturnType<typeof getDb>) {
  const insert = db.prepare(`INSERT INTO tags (tag_id, tag_name) VALUES (?, ?)`)
  for (let i = 0; i < TAG_NAMES.length; i++) {
    insert.run(i + 1, TAG_NAMES[i])
  }
}

function seedProductTags(db: ReturnType<typeof getDb>) {
  const insert = db.prepare(`INSERT OR IGNORE INTO product_tags (product_id, tag_id) VALUES (?, ?)`)
  for (let pid = 1; pid <= 80; pid++) {
    const numTags = randInt(1, 3)
    const tagIds = pickN(Array.from({ length: 20 }, (_, i) => i + 1), numTags)
    for (const tid of tagIds) {
      insert.run(pid, tid)
    }
  }
}

function seedPromotions(db: ReturnType<typeof getDb>) {
  const insert = db.prepare(`INSERT INTO promotions (promotion_id, promo_code, description, discount_type, discount_value, min_order_amount, max_uses, times_used, start_date, end_date, is_active) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, 1)`)

  for (let i = 0; i < PROMO_CODES.length; i++) {
    const p = PROMO_CODES[i]
    const startDaysAgo = randInt(180, 400)
    const startDate = dateBetween(startDaysAgo, startDaysAgo)
    const endDate = addDays(startDate, randInt(60, 300))
    const maxUses = randInt(100, 1000)
    insert.run(i + 1, p.code, p.desc, p.type, p.value, p.minOrder, maxUses, startDate, endDate)
  }
}

function seedOrders(db: ReturnType<typeof getDb>) {
  const insertOrder = db.prepare(`INSERT INTO orders (order_id, customer_id, shipping_address_id, order_date, status, subtotal, discount_amount, tax_amount, shipping_cost, total_amount, payment_method, currency) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'USD')`)

  // Get address IDs per customer
  const addresses = db.prepare("SELECT address_id, customer_id FROM customer_addresses WHERE is_default = 1").all() as { address_id: number; customer_id: number }[]
  const addrMap = new Map<number, number>()
  for (const a of addresses) addrMap.set(a.customer_id, a.address_id)

  const statuses = ['delivered', 'delivered', 'delivered', 'delivered', 'delivered', 'delivered', 'delivered', 'cancelled', 'returned', 'refunded']

  let orderId = 1
  const ordersPerCustomer = new Map<number, number>()

  // Ensure each customer gets 2-6 orders, total ~800
  for (let cid = 1; cid <= 200; cid++) {
    const numOrders = randInt(2, 6)
    ordersPerCustomer.set(cid, numOrders)
  }

  // Adjust to get closer to 800 total
  let totalPlanned = 0
  for (const n of ordersPerCustomer.values()) totalPlanned += n

  for (let cid = 1; cid <= 200; cid++) {
    const numOrders = ordersPerCustomer.get(cid) ?? 3
    for (let o = 0; o < numOrders; o++) {
      const orderDate = datetimeBetween(540, 1) // last 18 months
      const status = pick(statuses)
      const subtotal = Math.round((20 + rand() * 480) * 100) / 100
      const discountAmt = rand() > 0.7 ? Math.round(subtotal * (0.05 + rand() * 0.2) * 100) / 100 : 0
      const taxAmt = Math.round(subtotal * 0.08 * 100) / 100
      const shippingCost = rand() > 0.3 ? Math.round((5 + rand() * 15) * 100) / 100 : 0
      const totalAmount = Math.round((subtotal - discountAmt + taxAmt + shippingCost) * 100) / 100
      const payment = pick(PAYMENT_METHODS)
      const addrId = addrMap.get(cid) ?? null

      insertOrder.run(orderId, cid, addrId, orderDate, status, subtotal, discountAmt, taxAmt, shippingCost, totalAmount, payment)
      orderId++
    }
  }
}

function seedOrderItems(db: ReturnType<typeof getDb>) {
  const insert = db.prepare(`INSERT OR IGNORE INTO order_items (order_id, product_id, quantity, unit_price, discount_pct, line_total) VALUES (?, ?, ?, ?, ?, ?)`)

  const orderCount = (db.prepare("SELECT COUNT(*) as n FROM orders").get() as { n: number }).n

  for (let oid = 1; oid <= orderCount; oid++) {
    const numItems = randInt(1, 4)
    const usedProducts = new Set<number>()
    for (let i = 0; i < numItems; i++) {
      let pid = randInt(1, 80)
      // Ensure unique product per order
      let attempts = 0
      while (usedProducts.has(pid) && attempts < 20) {
        pid = randInt(1, 80)
        attempts++
      }
      if (usedProducts.has(pid)) continue
      usedProducts.add(pid)

      const qty = randInt(1, 5)
      const unitPrice = Math.round((10 + rand() * 300) * 100) / 100
      const discountPct = rand() > 0.7 ? Math.round(rand() * 0.3 * 100) / 100 : 0
      const lineTotal = Math.round(qty * unitPrice * (1 - discountPct) * 100) / 100
      insert.run(oid, pid, qty, unitPrice, discountPct, lineTotal)
    }
  }
}

function seedOrderEvents(db: ReturnType<typeof getDb>) {
  const insert = db.prepare(`INSERT INTO order_events (order_id, event_type, event_timestamp, actor, note) VALUES (?, ?, ?, ?, ?)`)

  const orders = db.prepare("SELECT order_id, order_date, status FROM orders").all() as { order_id: number; order_date: string; status: string }[]

  for (const order of orders) {
    // Always insert 'created'
    insert.run(order.order_id, 'created', order.order_date, 'system', null)

    if (order.status === 'delivered') {
      const shipped = addDaysDatetime(order.order_date.slice(0, 10), 1)
      insert.run(order.order_id, 'shipped', shipped, 'vendor', null)
      const delivered = addDaysDatetime(order.order_date.slice(0, 10), randInt(3, 7))
      insert.run(order.order_id, 'delivered', delivered, 'system', null)
    } else if (order.status === 'cancelled') {
      const cancelled = addDaysDatetime(order.order_date.slice(0, 10), randInt(0, 2))
      insert.run(order.order_id, 'cancelled', cancelled, 'customer', 'Customer requested cancellation')
    } else if (order.status === 'returned') {
      const shipped = addDaysDatetime(order.order_date.slice(0, 10), 1)
      insert.run(order.order_id, 'shipped', shipped, 'vendor', null)
      const delivered = addDaysDatetime(order.order_date.slice(0, 10), 4)
      insert.run(order.order_id, 'delivered', delivered, 'system', null)
      const returnReq = addDaysDatetime(order.order_date.slice(0, 10), randInt(7, 14))
      insert.run(order.order_id, 'return_requested', returnReq, 'customer', null)
      const returned = addDaysDatetime(order.order_date.slice(0, 10), randInt(15, 21))
      insert.run(order.order_id, 'returned', returned, 'system', null)
    } else if (order.status === 'refunded') {
      const refunded = addDaysDatetime(order.order_date.slice(0, 10), randInt(1, 5))
      insert.run(order.order_id, 'refunded', refunded, 'admin', 'Refund processed')
    }
  }
}

function seedReviews(db: ReturnType<typeof getDb>) {
  const insert = db.prepare(`INSERT OR IGNORE INTO reviews (product_id, customer_id, rating, title, body, is_verified_purchase) VALUES (?, ?, ?, ?, ?, 1)`)

  // Get delivered order items
  const deliveredItems = db.prepare(`
    SELECT oi.product_id, o.customer_id
    FROM order_items oi
    JOIN orders o ON o.order_id = oi.order_id
    WHERE o.status = 'delivered'
  `).all() as { product_id: number; customer_id: number }[]

  const reviewTitles = ['Great product!', 'Works well', 'Good value', 'Decent quality', 'As expected', 'Love it', 'Not bad', 'Excellent!', 'Could be better', 'Amazing quality']
  const reviewBodies = [
    'Really happy with this purchase. Would buy again.',
    'Does exactly what it says. Good quality.',
    'Arrived on time and works perfectly.',
    'Pretty good for the price. Recommended.',
    'Solid product, no complaints.',
  ]

  const seen = new Set<string>()
  for (const item of deliveredItems) {
    // 40% chance of review
    if (rand() > 0.4) continue
    const key = `${item.product_id}-${item.customer_id}`
    if (seen.has(key)) continue
    seen.add(key)

    const rating = randInt(1, 5)
    const title = pick(reviewTitles)
    const body = pick(reviewBodies)
    insert.run(item.product_id, item.customer_id, rating, title, body)
  }
}

function seedPromotionRedemptions(db: ReturnType<typeof getDb>) {
  const insert = db.prepare(`INSERT OR IGNORE INTO promotion_redemptions (promotion_id, order_id, customer_id, discount_applied) VALUES (?, ?, ?, ?)`)
  const updateTimesUsed = db.prepare(`UPDATE promotions SET times_used = times_used + 1 WHERE promotion_id = ?`)

  const orders = db.prepare("SELECT order_id, customer_id, total_amount FROM orders").all() as { order_id: number; customer_id: number; total_amount: number }[]

  for (const order of orders) {
    // 30% of orders use a promotion
    if (rand() > 0.3) continue
    const promoId = randInt(1, 8)
    const discountApplied = Math.round((1 + rand() * 30) * 100) / 100
    insert.run(promoId, order.order_id, order.customer_id, discountApplied)
    updateTimesUsed.run(promoId)
  }
}

function seedInventoryLogs(db: ReturnType<typeof getDb>) {
  const insert = db.prepare(`INSERT INTO inventory_logs (product_id, change_type, quantity_change, quantity_after, reference_order_id, logged_at, note) VALUES (?, ?, ?, ?, ?, ?, ?)`)

  // Initial restock for each product
  const productStocks = new Map<number, number>()
  for (let pid = 1; pid <= 80; pid++) {
    productStocks.set(pid, 200)
    const loggedAt = datetimeBetween(540, 500)
    insert.run(pid, 'restock', 200, 200, null, loggedAt, 'Initial stock')
  }

  // Sale entries from order items (chronologically)
  const orderItems = db.prepare(`
    SELECT oi.order_id, oi.product_id, oi.quantity, o.order_date
    FROM order_items oi
    JOIN orders o ON o.order_id = oi.order_id
    ORDER BY o.order_date
  `).all() as { order_id: number; product_id: number; quantity: number; order_date: string }[]

  for (const item of orderItems) {
    const currentStock = productStocks.get(item.product_id) ?? 200
    const newStock = Math.max(currentStock - item.quantity, 0)
    productStocks.set(item.product_id, newStock)
    insert.run(item.product_id, 'sale', -item.quantity, newStock, item.order_id, item.order_date, null)
  }
}

function seedVendorPayouts(db: ReturnType<typeof getDb>) {
  const insert = db.prepare(`INSERT INTO vendor_payouts (vendor_id, payout_amount, currency, period_start_date, period_end_date, status, paid_at) VALUES (?, ?, 'USD', ?, ?, 'completed', ?)`)

  // 4 quarterly payouts per vendor over last year
  const quarters = [
    { start: dateBetween(365, 365), end: dateBetween(275, 275) },
    { start: dateBetween(274, 274), end: dateBetween(185, 185) },
    { start: dateBetween(184, 184), end: dateBetween(95, 95) },
    { start: dateBetween(94, 94), end: dateBetween(5, 5) },
  ]

  for (let vid = 1; vid <= 12; vid++) {
    for (const q of quarters) {
      const amount = Math.round((500 + rand() * 9500) * 100) / 100
      const paidAt = addDays(q.end, randInt(5, 15))
      insert.run(vid, amount, q.start, q.end, paidAt)
    }
  }
}

function updateLifetimeSpend(db: ReturnType<typeof getDb>) {
  db.exec(`
    UPDATE customers SET lifetime_spend = COALESCE(
      (SELECT SUM(total_amount) FROM orders WHERE orders.customer_id = customers.customer_id AND orders.status NOT IN ('cancelled', 'refunded')),
      0.0
    )
  `)
}
