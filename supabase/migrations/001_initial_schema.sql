-- Initial schema for dental lab ERP
-- Tables: doctors, orders, transactions

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Doctors table
CREATE TABLE doctors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  phone2 TEXT,
  address TEXT NOT NULL,
  doctor_code TEXT NOT NULL UNIQUE,
  representative_name TEXT NOT NULL,
  representative_id UUID,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_doctors_code ON doctors(doctor_code);
CREATE INDEX idx_doctors_representative ON doctors(representative_id);

-- Orders table
CREATE TABLE orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id TEXT NOT NULL UNIQUE,
  doctor_id UUID NOT NULL REFERENCES doctors(id) ON DELETE CASCADE,
  patient_name TEXT NOT NULL,
  items JSONB NOT NULL DEFAULT '[]',
  discount NUMERIC(10,2) DEFAULT 0,
  total_price NUMERIC(10,2) NOT NULL,
  shade TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('Pending', 'In Progress', 'Completed', 'Delivered', 'New Case', 'Under Design', 'Waiting Dr Approval', 'Under Production', 'Try In', 'Ready', 'Returned for Adjustments')),
  delivery_date DATE NOT NULL,
  cost NUMERIC(10,2) NOT NULL,
  stl_url TEXT,
  supplier_id UUID,
  instructions TEXT,
  priority TEXT DEFAULT 'Normal' CHECK (priority IN ('Normal', 'Urgent')),
  delivery_type TEXT CHECK (delivery_type IN ('Final', 'TryIn')),
  needs_design_review BOOLEAN DEFAULT FALSE,
  technician_status TEXT CHECK (technician_status IN ('Pending', 'Approved', 'Rejected', 'NeedDetails', 'PMMA_First')),
  comments JSONB DEFAULT '[]',
  representative_id UUID,
  is_registered BOOLEAN DEFAULT FALSE,
  workflow_type TEXT CHECK (workflow_type IN ('full', 'split')),
  designer_id UUID,
  design_status TEXT CHECK (design_status IN ('pending', 'in_progress', 'completed')),
  design_price NUMERIC(10,2),
  actual_delivery_date DATE,
  feedback JSONB,
  is_redo BOOLEAN DEFAULT FALSE,
  original_order_id UUID REFERENCES orders(id),
  is_archived BOOLEAN NOT NULL DEFAULT FALSE,
  production_status TEXT NOT NULL DEFAULT 'not_started',
  issue_state TEXT NOT NULL DEFAULT 'none',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_orders_case_id ON orders(case_id);
CREATE INDEX idx_orders_doctor ON orders(doctor_id);
CREATE INDEX idx_orders_status ON orders(status);
CREATE INDEX idx_orders_delivery_date ON orders(delivery_date);
CREATE INDEX idx_orders_created_at ON orders(created_at DESC);

-- Transactions table
CREATE TABLE transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type TEXT NOT NULL CHECK (type IN ('income', 'expense')),
  amount NUMERIC(10,2) NOT NULL,
  category TEXT NOT NULL,
  date DATE NOT NULL,
  description TEXT NOT NULL,
  entity_id UUID,
  entity_type TEXT CHECK (entity_type IN ('doctor', 'supplier', 'general', 'designer')),
  is_registered BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_transactions_type ON transactions(type);
CREATE INDEX idx_transactions_date ON transactions(date DESC);
CREATE INDEX idx_transactions_entity ON transactions(entity_id);

-- Services table
CREATE TABLE services (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  selling_price NUMERIC(10,2) NOT NULL,
  cost_price NUMERIC(10,2) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Suppliers table
CREATE TABLE suppliers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  username TEXT,
  phone TEXT NOT NULL,
  custom_prices JSONB,
  milling_prices JSONB,
  redo_cost_percentage NUMERIC(5,2),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Users table (for Reps, Designers, Accountants, Admins)
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username TEXT NOT NULL UNIQUE,
  password TEXT NOT NULL, -- In production, use Supabase Auth. This is for legacy data structure migration support.
  role TEXT NOT NULL CHECK (role IN ('admin', 'lab', 'representative', 'accountant', 'designer')),
  name TEXT NOT NULL,
  entity_id UUID,
  base_salary NUMERIC(10,2),
  unit_rate NUMERIC(10,2),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Triggers for updated_at
CREATE TRIGGER update_doctors_updated_at BEFORE UPDATE ON doctors
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_orders_updated_at BEFORE UPDATE ON orders
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_transactions_updated_at BEFORE UPDATE ON transactions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Add active flags for users and suppliers (from temp migration 089)
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS deactivated_at TIMESTAMPTZ DEFAULT NULL;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;

-- Create order_issues table (from temp migration 087)
CREATE TABLE IF NOT EXISTS order_issues (
    id               UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    order_id         UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    issue_type       TEXT NOT NULL CHECK (issue_type IN ('returned','rejected','cancelled','redo')),
    cause_category   TEXT NOT NULL DEFAULT 'other'
                          CHECK (cause_category IN ('lab','doctor','scan','design','communication','other')),
    notes            TEXT,
    reporter_id      UUID REFERENCES users(id),
    reporter_name    TEXT,
    resolved_at      TIMESTAMPTZ,
    resolution_notes TEXT,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_order_issues_order_id   ON order_issues(order_id);
CREATE INDEX IF NOT EXISTS idx_order_issues_issue_type ON order_issues(issue_type);
CREATE INDEX IF NOT EXISTS idx_order_issues_created_at ON order_issues(created_at DESC);
