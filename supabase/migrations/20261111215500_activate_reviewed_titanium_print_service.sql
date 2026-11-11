UPDATE public.services
SET is_active = true
WHERE name = 'Framework Titanium Printed'
  AND catalog_route_id = 'ba500000-0000-4000-8000-000000000002'
  AND catalog_try_in_route_id = 'ba100000-0000-4000-8000-000000000001'
  AND is_active IS DISTINCT FROM true;
