-- Add print_count column to invoices table to track number of printings
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS print_count INTEGER DEFAULT 0;
