-- Add supplier_code column to suppliers table
ALTER TABLE suppliers ADD COLUMN supplier_code VARCHAR(20);

-- Add unique constraint to ensure no duplicate codes
ALTER TABLE suppliers ADD CONSTRAINT suppliers_supplier_code_key UNIQUE (supplier_code);

-- Add comment
COMMENT ON COLUMN suppliers.supplier_code IS 'Unique code for the supplier/lab to be used in Excel imports';
