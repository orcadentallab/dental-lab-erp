UPDATE public.production_route_stages
SET condition = coalesce(condition, '{}'::jsonb) || '{"delivery_type":"TryIn"}'::jsonb
WHERE route_id = 'ba100000-0000-4000-8000-000000000001'
  AND step_no IN (20, 30, 40, 50);
