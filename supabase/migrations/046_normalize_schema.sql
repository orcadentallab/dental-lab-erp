-- Migration 046: Normalize Schema (Items and Comments)
-- Date: 2026-01-30

-- 1. Create order_items table
CREATE TABLE IF NOT EXISTS order_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    product_type TEXT,
    teeth_numbers JSONB, -- Storing as JSONB array ["11", "21"] for flexibility
    shade TEXT,
    price NUMERIC(10,2) DEFAULT 0,
    count INTEGER DEFAULT 1,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_order_items_order_id ON order_items(order_id);

-- 2. Create order_comments table
CREATE TABLE IF NOT EXISTS order_comments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id) ON DELETE SET NULL, -- Can be null if system comment
    user_name TEXT, -- Store generic name if user_id is null or just for cache
    content TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_order_comments_order_id ON order_comments(order_id);

-- 3. Backfill Data Function
CREATE OR REPLACE FUNCTION backfill_normalized_data() RETURNS void AS $$
DECLARE
    r RECORD;
    item JSONB;
    comment JSONB;
BEGIN
    -- Backfill Items
    FOR r IN SELECT id, items FROM orders WHERE items IS NOT NULL AND jsonb_array_length(items) > 0 LOOP
        FOR item IN SELECT * FROM jsonb_array_elements(r.items) LOOP
            INSERT INTO order_items (order_id, product_type, teeth_numbers, shade, price, count)
            VALUES (
                r.id,
                item->>'type',
                item->'teethNumbers', -- Keep as JSONB array
                item->>'shade',
                (item->>'price')::numeric,
                COALESCE((item->>'count')::int, 1)
            );
        END LOOP;
    END LOOP;

    -- Backfill Comments
    FOR r IN SELECT id, comments FROM orders WHERE comments IS NOT NULL AND jsonb_array_length(comments) > 0 LOOP
        FOR comment IN SELECT * FROM jsonb_array_elements(r.comments) LOOP
            INSERT INTO order_comments (order_id, user_id, user_name, content, created_at)
            VALUES (
                r.id,
                (comment->>'userId')::uuid, -- Might fail if UUID is invalid string, but we assume data integrity or null
                comment->>'userName',
                comment->>'text',
                COALESCE((comment->>'createdAt')::timestamptz, NOW())
            );
        END LOOP;
    END LOOP;
END;
$$ LANGUAGE plpgsql;

-- 4. Execute Backfill
SELECT backfill_normalized_data();

-- 5. Cleanup (Optional - drop function, keep columns for now as safety)
DROP FUNCTION backfill_normalized_data();

-- 6. Grant Permissions (RLS will handle row access, but authenticated needs basic CRUD)
ALTER TABLE order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_comments ENABLE ROW LEVEL SECURITY;

-- Policies for order_items (Inherit from Order access roughly)
-- Ideally we use a policy that checks the parent order, but basic role checks + EXISTS is safer
CREATE POLICY "order_items_select" ON order_items FOR SELECT TO authenticated
USING (
    EXISTS (SELECT 1 FROM orders WHERE orders.id = order_items.order_id) -- Simplified: if you can see order, you can see items. relies on Order RLS.
    -- Wait, RLS on 'orders' doesn't auto-propagate to this subquery unless we reuse the logic.
    -- Better: Duplicate the logic or assume if you have the ID you can query it? No, unsafe.
    -- BEST: "USING ( EXISTS ( SELECT 1 FROM orders WHERE orders.id = order_items.order_id ) )" 
    -- This works because the subquery to 'orders' will be filtered by 'orders' RLS policies!
);

-- Same for insert/update/delete - usually specific roles or admin
CREATE POLICY "order_items_all" ON order_items FOR ALL TO authenticated
USING (
    EXISTS (SELECT 1 FROM orders WHERE orders.id = order_items.order_id)
)
WITH CHECK (
    EXISTS (SELECT 1 FROM orders WHERE orders.id = order_items.order_id)
);

-- Policies for order_comments
CREATE POLICY "order_comments_select" ON order_comments FOR SELECT TO authenticated
USING (
    EXISTS (SELECT 1 FROM orders WHERE orders.id = order_comments.order_id)
);

CREATE POLICY "order_comments_insert" ON order_comments FOR INSERT TO authenticated
WITH CHECK (
    EXISTS (SELECT 1 FROM orders WHERE orders.id = order_comments.order_id)
);
-- Update/Delete only for Admin or owner
CREATE POLICY "order_comments_mod" ON order_comments FOR UPDATE TO authenticated
USING (auth.uid() = user_id OR get_my_role() = 'admin');

CREATE POLICY "order_comments_del" ON order_comments FOR DELETE TO authenticated
USING (auth.uid() = user_id OR get_my_role() = 'admin');

