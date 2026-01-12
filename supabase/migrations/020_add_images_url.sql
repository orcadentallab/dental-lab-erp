-- Migration 020: Add images_url to orders
-- Description: Add a column to store valid image links (Google Drive, Dropbox, etc)

ALTER TABLE orders
ADD COLUMN IF NOT EXISTS images_url TEXT;
