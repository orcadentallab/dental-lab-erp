-- Migration 009: Add Discount Column to Orders
-- Description: Adds a discount field to tracking order discounts.

ALTER TABLE orders ADD COLUMN IF NOT EXISTS discount DECIMAL(10,2) DEFAULT 0;
