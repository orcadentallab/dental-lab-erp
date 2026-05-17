-- Migration 073: Add 'settled' as valid transaction status
-- This allows individual expense records to be marked as settled while keeping them for audit history.

-- Defensively ensure the status column exists. In production it was added manually
-- via the SQL editor before this migration was authored; locally we create it here
-- so the constraint below can attach. Default 'pending' matches the legacy
-- is_approved=false equivalence.
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'pending';

-- Drop the existing check constraint (find its name first)
DO $$
DECLARE
    constraint_name TEXT;
BEGIN
    SELECT conname INTO constraint_name
    FROM pg_constraint
    WHERE conrelid = 'transactions'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%pending%approved%rejected%';

    IF constraint_name IS NOT NULL THEN
        EXECUTE format('ALTER TABLE transactions DROP CONSTRAINT IF EXISTS %I', constraint_name);
    END IF;
END $$;

-- Also try the known name just in case
ALTER TABLE transactions DROP CONSTRAINT IF EXISTS transactions_status_check;

-- Re-add the constraint with 'settled' included
ALTER TABLE transactions
    ADD CONSTRAINT transactions_status_check
    CHECK (status IN ('pending', 'approved', 'rejected', 'settled'));
