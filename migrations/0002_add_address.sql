-- Add address and poi columns for reverse geocoding data
ALTER TABLE locations ADD COLUMN address TEXT;
ALTER TABLE locations ADD COLUMN poi TEXT;
