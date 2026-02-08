-- Doctor Registration Requests Table
-- Allows doctors to self-register, pending admin approval

CREATE TABLE IF NOT EXISTS doctor_registration_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- Doctor information
    name TEXT NOT NULL,
    phone TEXT NOT NULL,
    phone2 TEXT,
    address TEXT NOT NULL,
    email TEXT NOT NULL,
    clinic_name TEXT,
    
    -- Request status
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
    
    -- Linking (after approval)
    doctor_id UUID REFERENCES doctors(id),
    user_id UUID REFERENCES users(id),
    
    -- Admin review
    admin_notes TEXT,
    reviewed_by UUID REFERENCES users(id),
    reviewed_at TIMESTAMPTZ,
    
    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_registration_requests_status ON doctor_registration_requests(status);
CREATE INDEX IF NOT EXISTS idx_registration_requests_phone ON doctor_registration_requests(phone);
CREATE INDEX IF NOT EXISTS idx_registration_requests_email ON doctor_registration_requests(email);

-- RLS Policies
ALTER TABLE doctor_registration_requests ENABLE ROW LEVEL SECURITY;

-- Allow anyone to insert (public registration)
CREATE POLICY "allow_public_insert" ON doctor_registration_requests
    FOR INSERT TO anon, authenticated
    WITH CHECK (true);

-- Only admins can view all requests
CREATE POLICY "admin_view_all" ON doctor_registration_requests
    FOR SELECT TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM users 
            WHERE users.auth_id = auth.uid() 
            AND users.role = 'admin'
        )
    );

-- Only admins can update requests
CREATE POLICY "admin_update" ON doctor_registration_requests
    FOR UPDATE TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM users 
            WHERE users.auth_id = auth.uid() 
            AND users.role = 'admin'
        )
    );

-- Update trigger
CREATE TRIGGER update_registration_requests_updated_at
    BEFORE UPDATE ON doctor_registration_requests
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Add comment
COMMENT ON TABLE doctor_registration_requests IS 'Self-registration requests from doctors pending admin approval';
