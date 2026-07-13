-- Update cashbox type options check constraint
-- Drop old constraint if exists (usually cashboxes_type_check)
ALTER TABLE cashboxes DROP CONSTRAINT IF EXISTS cashboxes_type_check;

-- Add updated constraint with 'cash', 'bank', 'wallet', 'other'
ALTER TABLE cashboxes ADD CONSTRAINT cashboxes_type_check CHECK (type IN ('cash', 'bank', 'wallet', 'other'));
