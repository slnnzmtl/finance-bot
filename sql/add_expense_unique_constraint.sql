-- Unique constraint for idempotent Wise → expense inserts.
-- Run once in Supabase SQL Editor.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'expense_name_amount_paid_date_key'
      AND conrelid = 'public.expense'::regclass
  ) THEN
    ALTER TABLE public.expense
      ADD CONSTRAINT expense_name_amount_paid_date_key
      UNIQUE (name, amount, paid_date);
  END IF;
END;
$$;
