-- Add 'representative' to transactions entity_type CHECK constraint
ALTER TABLE transactions DROP CONSTRAINT IF EXISTS transactions_entity_type_check;
ALTER TABLE transactions ADD CONSTRAINT transactions_entity_type_check
  CHECK (entity_type IN ('doctor', 'supplier', 'general', 'designer', 'representative'));
