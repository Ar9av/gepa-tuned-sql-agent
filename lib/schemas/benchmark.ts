export const BENCHMARK_DDL_PROMPT = `
Create this exact SQLite schema for a marketplace analytics platform.

Output ONLY these CREATE TABLE statements exactly as written. No INSERT, no data, no comments.

DROP TABLE IF EXISTS inventory_logs;
DROP TABLE IF EXISTS promotion_redemptions;
DROP TABLE IF EXISTS promotions;
DROP TABLE IF EXISTS order_events;
DROP TABLE IF EXISTS order_items;
DROP TABLE IF EXISTS orders;
DROP TABLE IF EXISTS product_tags;
DROP TABLE IF EXISTS tags;
DROP TABLE IF EXISTS product_images;
DROP TABLE IF EXISTS reviews;
DROP TABLE IF EXISTS products;
DROP TABLE IF EXISTS categories;
DROP TABLE IF EXISTS vendor_payouts;
DROP TABLE IF EXISTS vendors;
DROP TABLE IF EXISTS customer_addresses;
DROP TABLE IF EXISTS customers;

CREATE TABLE customers (
  customer_id INTEGER PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  phone TEXT,
  signup_date TEXT NOT NULL DEFAULT (date('now')),
  birth_date TEXT,
  gender TEXT CHECK(gender IN ('male', 'female', 'non_binary', 'prefer_not_to_say')),
  lifetime_spend REAL NOT NULL DEFAULT 0.0,
  tier TEXT NOT NULL DEFAULT 'bronze' CHECK(tier IN ('bronze', 'silver', 'gold', 'platinum')),
  is_active INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0, 1)),
  referral_customer_id INTEGER REFERENCES customers(customer_id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE customer_addresses (
  address_id INTEGER PRIMARY KEY,
  customer_id INTEGER NOT NULL REFERENCES customers(customer_id),
  label TEXT NOT NULL DEFAULT 'home' CHECK(label IN ('home', 'work', 'shipping', 'billing', 'other')),
  street_line1 TEXT NOT NULL,
  street_line2 TEXT,
  city TEXT NOT NULL,
  state_province TEXT,
  postal_code TEXT NOT NULL,
  country_code TEXT NOT NULL DEFAULT 'US',
  is_default INTEGER NOT NULL DEFAULT 0 CHECK(is_default IN (0, 1)),
  UNIQUE(customer_id, label)
);

CREATE TABLE vendors (
  vendor_id INTEGER PRIMARY KEY,
  company_name TEXT NOT NULL UNIQUE,
  contact_email TEXT NOT NULL,
  contact_phone TEXT,
  country_code TEXT NOT NULL DEFAULT 'US',
  commission_rate REAL NOT NULL DEFAULT 0.15 CHECK(commission_rate BETWEEN 0.0 AND 1.0),
  rating_avg REAL DEFAULT 0.0 CHECK(rating_avg BETWEEN 0.0 AND 5.0),
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'active', 'suspended', 'terminated')),
  onboarded_at TEXT NOT NULL DEFAULT (date('now')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE vendor_payouts (
  payout_id INTEGER PRIMARY KEY,
  vendor_id INTEGER NOT NULL REFERENCES vendors(vendor_id),
  payout_amount REAL NOT NULL CHECK(payout_amount > 0),
  currency TEXT NOT NULL DEFAULT 'USD',
  period_start_date TEXT NOT NULL,
  period_end_date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'processing', 'completed', 'failed')),
  paid_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(vendor_id, period_start_date, period_end_date)
);

CREATE TABLE categories (
  category_id INTEGER PRIMARY KEY,
  parent_category_id INTEGER REFERENCES categories(category_id),
  category_name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  depth_level INTEGER NOT NULL DEFAULT 0 CHECK(depth_level >= 0),
  is_active INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0, 1)),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(parent_category_id, category_name)
);

CREATE TABLE products (
  product_id INTEGER PRIMARY KEY,
  vendor_id INTEGER NOT NULL REFERENCES vendors(vendor_id),
  category_id INTEGER NOT NULL REFERENCES categories(category_id),
  sku TEXT NOT NULL UNIQUE,
  product_name TEXT NOT NULL,
  description TEXT,
  unit_price REAL NOT NULL CHECK(unit_price >= 0),
  cost_price REAL NOT NULL CHECK(cost_price >= 0),
  weight_kg REAL CHECK(weight_kg >= 0),
  stock_quantity INTEGER NOT NULL DEFAULT 0 CHECK(stock_quantity >= 0),
  reorder_level INTEGER NOT NULL DEFAULT 10,
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft', 'active', 'out_of_stock', 'discontinued')),
  listed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE product_images (
  image_id INTEGER PRIMARY KEY,
  product_id INTEGER NOT NULL REFERENCES products(product_id),
  url TEXT NOT NULL,
  alt_text TEXT,
  display_order INTEGER NOT NULL DEFAULT 0,
  is_primary INTEGER NOT NULL DEFAULT 0 CHECK(is_primary IN (0, 1)),
  uploaded_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(product_id, display_order)
);

CREATE TABLE tags (
  tag_id INTEGER PRIMARY KEY,
  tag_name TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE product_tags (
  product_id INTEGER NOT NULL REFERENCES products(product_id),
  tag_id INTEGER NOT NULL REFERENCES tags(tag_id),
  PRIMARY KEY (product_id, tag_id)
);

CREATE TABLE reviews (
  review_id INTEGER PRIMARY KEY,
  product_id INTEGER NOT NULL REFERENCES products(product_id),
  customer_id INTEGER NOT NULL REFERENCES customers(customer_id),
  rating INTEGER NOT NULL CHECK(rating BETWEEN 1 AND 5),
  title TEXT,
  body TEXT,
  is_verified_purchase INTEGER NOT NULL DEFAULT 0 CHECK(is_verified_purchase IN (0, 1)),
  helpful_votes INTEGER NOT NULL DEFAULT 0 CHECK(helpful_votes >= 0),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(product_id, customer_id)
);

CREATE TABLE orders (
  order_id INTEGER PRIMARY KEY,
  customer_id INTEGER NOT NULL REFERENCES customers(customer_id),
  shipping_address_id INTEGER REFERENCES customer_addresses(address_id),
  order_date TEXT NOT NULL DEFAULT (datetime('now')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'confirmed', 'processing', 'shipped', 'delivered', 'cancelled', 'returned', 'refunded')),
  subtotal REAL NOT NULL CHECK(subtotal >= 0),
  discount_amount REAL NOT NULL DEFAULT 0.0 CHECK(discount_amount >= 0),
  tax_amount REAL NOT NULL DEFAULT 0.0 CHECK(tax_amount >= 0),
  shipping_cost REAL NOT NULL DEFAULT 0.0 CHECK(shipping_cost >= 0),
  total_amount REAL NOT NULL CHECK(total_amount >= 0),
  payment_method TEXT CHECK(payment_method IN ('credit_card', 'debit_card', 'paypal', 'bank_transfer', 'crypto', 'gift_card')),
  currency TEXT NOT NULL DEFAULT 'USD',
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE order_items (
  order_item_id INTEGER PRIMARY KEY,
  order_id INTEGER NOT NULL REFERENCES orders(order_id),
  product_id INTEGER NOT NULL REFERENCES products(product_id),
  quantity INTEGER NOT NULL CHECK(quantity > 0),
  unit_price REAL NOT NULL CHECK(unit_price >= 0),
  discount_pct REAL NOT NULL DEFAULT 0.0 CHECK(discount_pct BETWEEN 0.0 AND 1.0),
  line_total REAL NOT NULL CHECK(line_total >= 0),
  UNIQUE(order_id, product_id)
);

CREATE TABLE order_events (
  event_id INTEGER PRIMARY KEY,
  order_id INTEGER NOT NULL REFERENCES orders(order_id),
  event_type TEXT NOT NULL CHECK(event_type IN ('created', 'confirmed', 'payment_received', 'processing', 'shipped', 'out_for_delivery', 'delivered', 'cancelled', 'return_requested', 'returned', 'refunded')),
  event_timestamp TEXT NOT NULL DEFAULT (datetime('now')),
  actor TEXT CHECK(actor IN ('system', 'customer', 'vendor', 'admin')),
  note TEXT
);

CREATE TABLE promotions (
  promotion_id INTEGER PRIMARY KEY,
  promo_code TEXT NOT NULL UNIQUE,
  description TEXT,
  discount_type TEXT NOT NULL CHECK(discount_type IN ('percentage', 'fixed_amount', 'free_shipping', 'buy_x_get_y')),
  discount_value REAL NOT NULL CHECK(discount_value >= 0),
  min_order_amount REAL DEFAULT 0.0,
  max_uses INTEGER,
  times_used INTEGER NOT NULL DEFAULT 0,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK(end_date >= start_date)
);

CREATE TABLE promotion_redemptions (
  redemption_id INTEGER PRIMARY KEY,
  promotion_id INTEGER NOT NULL REFERENCES promotions(promotion_id),
  order_id INTEGER NOT NULL REFERENCES orders(order_id),
  customer_id INTEGER NOT NULL REFERENCES customers(customer_id),
  discount_applied REAL NOT NULL CHECK(discount_applied > 0),
  redeemed_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(promotion_id, order_id)
);

CREATE TABLE inventory_logs (
  log_id INTEGER PRIMARY KEY,
  product_id INTEGER NOT NULL REFERENCES products(product_id),
  change_type TEXT NOT NULL CHECK(change_type IN ('restock', 'sale', 'return', 'adjustment', 'damaged', 'transferred')),
  quantity_change INTEGER NOT NULL,
  quantity_after INTEGER NOT NULL CHECK(quantity_after >= 0),
  reference_order_id INTEGER REFERENCES orders(order_id),
  logged_at TEXT NOT NULL DEFAULT (datetime('now')),
  note TEXT
);
`

export const BENCHMARK_SCHEMA_DESCRIPTION = "Marketplace Analytics Platform — a multi-vendor e-commerce marketplace with customers, vendors, hierarchical categories, products, tags (many-to-many), orders with event tracking, reviews, promotions with redemptions, inventory logs (time-series), vendor payouts, and self-referential category trees. Supports complex analytical queries across 16 tables."
