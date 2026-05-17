-- Migration 036a: Remove Duplicate Indexes (SAFE)
-- Risk: LOW - just cleanup

DROP INDEX IF EXISTS idx_doctors_representative;
DROP INDEX IF EXISTS idx_orders_doctor;
DROP INDEX IF EXISTS idx_transactions_entity;

-- Done! These were duplicates of:
-- idx_doctors_representative_id
-- idx_orders_doctor_id
-- idx_transactions_entity_id
