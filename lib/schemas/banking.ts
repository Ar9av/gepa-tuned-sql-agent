export const BANKING_DDL_PROMPT = `
Generate SQLite DDL for a realistic banking database.

Output ONLY CREATE TABLE and DROP TABLE IF EXISTS statements. No INSERT, no data, no comments.

Tables required: branches, customers, accounts, transactions, transfers, loans, loan_payments, fraud_flags

Requirements:
- Use proper SQLite types (INTEGER, TEXT, REAL, NUMERIC)
- Add FOREIGN KEY constraints
- Add CHECK constraints where sensible
- branches: id, name, city, country, manager_name, opened_at
- customers: id, branch_id, name, email, phone, address, dob, kyc_status (pending/verified/rejected), created_at
- accounts: id, customer_id, branch_id, type (checking/savings/credit), balance, currency, status (active/dormant/closed), opened_at, closed_at
- transactions: id, account_id, type (credit/debit), amount, category (salary/groceries/utilities/entertainment/transfer/other), description, merchant, balance_after, created_at
- transfers: id, from_account_id, to_account_id, amount, status (pending/completed/failed), initiated_at, completed_at
- loans: id, customer_id, account_id, loan_type (personal/mortgage/auto/business), principal, interest_rate, term_months, status (active/paid_off/defaulted), disbursed_at
- loan_payments: id, loan_id, amount, principal_component, interest_component, payment_date, status (on_time/late/missed)
- fraud_flags: id, account_id, transaction_id, flag_type, severity (low/medium/high/critical), description, flagged_at, resolved_at, is_resolved

Start with DROP TABLE IF EXISTS for each table in reverse dependency order.
`
