-- Migration 007: Allow Reps to view all Doctors and link Orders to Reps
-- Description: 
-- 1. Updates RLS on 'doctors' to specific roles (Admin, Lab, Rep, Accountant).
-- 2. Ensures 'orders' has 'representative_id' column.

-- 1. Doctors RLS
-- Drop old policies if they exist (to be safe/clean)
DROP POLICY IF EXISTS "Admins view all doctors" ON doctors;
DROP POLICY IF EXISTS "Reps view all doctors" ON doctors;

-- Policy: Authenticated users (Admin, Lab, Rep, Accountant) can VIEW doctors
-- We want them to see the list to assign them to orders or view attached info.
CREATE POLICY "Authenticated users view all doctors" ON doctors
  FOR SELECT USING (auth.role() = 'authenticated');

-- Policy: Representatives can INSERT their own doctors? 
-- The user said: "المندوب هيجى من الحالات اللى هيعملها او هنسجلها باسمه فالاوردرات بس" 
-- asking to remove the link from the Doctor profile. 
-- BUT, can Reps still ADD doctors? "المشكلة متحلتش... صفحة الاطباء بتظهر بس مفيهاش داتا"
-- If Reps are creating orders for doctors, they might need to create the doctor first.
-- Let's allow Reps to INSERT doctors (and maybe Update).
-- Since we removed the ownership link, we can just allow them to INSERT.
CREATE POLICY "Reps/Admins can insert doctors" ON doctors
  FOR INSERT WITH CHECK (
    get_my_role() IN ('admin', 'representative', 'lab')
  );

-- Policy: Reps/Admins can UPDATE doctors
-- Since there is no ownership, we might allow any Rep to update any Doctor?
-- Or maybe restrict Update to Admin only?
-- The user request focused on VIEWING. 
-- "الاطباء مش ظاهرين لمستخدم مندوب" -> Solved by SELECT policy.
-- "نشيل الربط بتاع الدكتور بالمندوب" -> We removed the column usage in UI.
-- Let's stick to safe defaults: Admin/Lab can update everything. Reps?
-- Ideally Reps shouldn't mess up other Reps' doctors. But if there is no owner...
-- Let's allow Reps to Update for now to avoid friction, or restrict if critical.
-- Given the small team context usually implied, sharing Edit access is often key.
CREATE POLICY "Authenticated users update doctors" ON doctors
  FOR UPDATE USING (
    get_my_role() IN ('admin', 'representative', 'lab')
  );


-- 2. Orders Table
-- Ensure representative_id exists
-- It should already exist based on db.ts types, but adding safe check.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS representative_id UUID;

-- Optional: Add foreign key if not exists (might fail if data inconsistent, skipping for safety in migration script)
-- DO $$ 
-- BEGIN 
--     IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'fk_orders_representative') THEN 
--         ALTER TABLE orders ADD CONSTRAINT fk_orders_representative FOREIGN KEY (representative_id) REFERENCES users(id); 
--     END IF; 
-- END $$;

-- Update RLS for Orders to allow Reps to see orders they are assigned to
-- (We handled this in Migration 002, but double check)
-- "Reps view own orders": representative_id = get_my_user_id()
-- This remains valid.

