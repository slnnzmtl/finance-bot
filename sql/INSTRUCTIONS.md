# Ledger setup

This bot talks to Supabase via the hosted MCP `execute_sql` tool (not a local RPC).

1. Ensure `public.expense` and `public.category` exist (see personal-assistant docs if needed).
2. Run [`add_expense_unique_constraint.sql`](./add_expense_unique_constraint.sql) once so Wise sync can use `ON CONFLICT (name, amount, paid_date) DO NOTHING`.
