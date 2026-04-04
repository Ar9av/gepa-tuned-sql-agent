export const ECOMMERCE_DDL_PROMPT = `
Generate SQLite DDL for a realistic e-commerce database.

Output ONLY CREATE TABLE and DROP TABLE IF EXISTS statements. No INSERT, no data, no comments.

Tables required: customers, categories, products, orders, order_items, reviews

Requirements:
- Use proper SQLite types (INTEGER, TEXT, REAL, NUMERIC)
- Add FOREIGN KEY constraints
- Add CHECK constraints where sensible (status IN (...), rating BETWEEN 1 AND 5, etc.)
- customers: id, name, email, phone, city, country, created_at, last_login_at
- categories: id, name, slug, parent_id (self-referential for subcategories)
- products: id, category_id, name, description, price, stock_quantity, created_at
- orders: id, customer_id, status (pending/shipped/delivered/cancelled/returned), total_amount, created_at, shipped_at, delivered_at
- order_items: id, order_id, product_id, quantity, unit_price
- reviews: id, customer_id, product_id, rating, title, body, created_at

Start with DROP TABLE IF EXISTS for each table in reverse dependency order.
`
