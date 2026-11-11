BEGIN;

-- Separate the reviewed production maps from the legacy route lookup.
ALTER TABLE public.services
    ADD COLUMN catalog_route_id uuid REFERENCES public.production_routes(id),
    ADD COLUMN catalog_try_in_route_id uuid REFERENCES public.production_routes(id),
    ADD COLUMN catalog_route_kind text CHECK (catalog_route_kind IN ('production','add_on','logistics'));

INSERT INTO public.production_routes (id,name_ar,ignores_global_stages,is_active,notes) VALUES
    ('ba500000-0000-4000-8000-000000000001','طباعة داخلية',true,false,'P — قالب مراجع للتشغيل الداخلي لاحقًا'),
    ('ba500000-0000-4000-8000-000000000002','نهائي من معمل خارجي',true,false,'E — قالب مراجع، والتشغيل الخارجي الحالي يستمر بالمسار القائم');

INSERT INTO public.production_route_stages
    (route_id,stage_id,mode,step_no,name_override,execution_override,driven_by,allowed_roles,advance_mode)
SELECT ('ba500000-0000-4000-8000-00000000000'||template)::uuid,stage.id,'included',step,label,execution,driver,roles,advance
FROM (VALUES
    (1,10,'design','التصميم وفحص التصميم','internal','designer_dashboard',ARRAY['designer','admin'],'auto'),
    (1,20,'printing','الطباعة الداخلية','internal','my_tasks',ARRAY['admin','coordinator','production_manager','technician'],'auto'),
    (1,30,'qc','الفحص الداخلي','internal','my_tasks',ARRAY['admin'],'qc_gate'),
    (1,40,'shipping','تغليف وشحن','external','order_status',ARRAY[]::text[],'manual'),
    (2,10,'design','التصميم وفحص التصميم','internal','designer_dashboard',ARRAY['designer','admin'],'auto'),
    (2,20,'external_full','التصنيع والتشطيب عند المعمل الخارجي','external','external_wo',ARRAY['admin','production_manager'],'auto'),
    (2,30,'qc','الفحص النهائي الداخلي','internal','my_tasks',ARRAY['admin'],'qc_gate'),
    (2,40,'shipping','تغليف وشحن','external','order_status',ARRAY[]::text[],'manual')
) AS plan(template,step,code,label,execution,driver,roles,advance)
JOIN public.production_stages stage ON stage.code=plan.code;

CREATE TEMP TABLE reviewed_families (name_ar text, name_en text, color text) ON COMMIT DROP;
INSERT INTO reviewed_families VALUES
    ('زيركون','Zirconia','emerald'), ('إيماكس','Emax','blue'), ('بورسلين على معدن','PFM','indigo'),
    ('زرعات','Implant','violet'), ('تركيبات متحركة','Removable','amber'),
    ('البروفات والريزن','Try-ins & Resin','rose'), ('إضافات','Extras','slate');

INSERT INTO public.service_families(name_ar,name_en,color)
SELECT f.name_ar,f.name_en,f.color FROM reviewed_families f
WHERE NOT EXISTS (SELECT 1 FROM public.service_families existing WHERE existing.name_en=f.name_en);

-- New names receive new IDs. Old names and rates stay intact for saved invoices.
CREATE TEMP TABLE reviewed_merges (name text, old_names text[]) ON COMMIT DROP;
INSERT INTO reviewed_merges VALUES
    ('Emax Press',ARRAY['Emax Press Ant','Emax Press Post']),
    ('Emax Press Ivoclar',ARRAY['Emax Press Ivoclar Ant','Emax Press Ivoclar Post']),
    ('RPD by Tooth',ARRAY['Removable Partial Denture 1st tooth','RPD Any teeth after the 1st']),
    ('Cutback & Layering',ARRAY['Cut Back']);

INSERT INTO public.services(name,selling_price,cost_price,designer_price,milling_price,sort_order)
SELECT merge.name, source.selling_price, source.cost_price, source.designer_price, source.milling_price, source.sort_order
FROM reviewed_merges merge CROSS JOIN LATERAL (
    SELECT s.* FROM public.services s WHERE s.name=ANY(merge.old_names)
    ORDER BY s.cost_price, s.sort_order NULLS LAST, s.name LIMIT 1
) source
WHERE NOT EXISTS (SELECT 1 FROM public.services s WHERE s.name=merge.name);

INSERT INTO public.services(name,selling_price,cost_price,is_active)
SELECT 'Framework Titanium Printed',0,0,false
WHERE NOT EXISTS (SELECT 1 FROM public.services WHERE name='Framework Titanium Printed');

UPDATE public.services s SET is_active=false
WHERE s.name IN ('Elite Cut Back','Scan Appliance Full Arch','Scan Appliance Half Arch','Zircomax','Zircomax Elite','Zr Sirona HT')
   OR EXISTS (SELECT 1 FROM reviewed_merges m WHERE s.name=ANY(m.old_names));

WITH assignments(name,family,route,trial) AS (VALUES
    ('Crown Lengthening Guide','Try-ins & Resin','P',false), ('Custom Abutment Ti','Implant','E',true),
    ('Custom Abutment Zr','Implant','E',true), ('Cutback & Layering','Extras','A',false),
    ('Each Implant Extra in Guide','Try-ins & Resin','A',false), ('Emax CAD','Emax','E',true),
    ('Emax Press','Emax','E',true), ('Emax Press Ivoclar','Emax','E',true),
    ('Framework Ni-Cr Printed','Implant','E',true), ('Framework Titanium Milled','Implant','E',true),
    ('Framework Titanium Printed','Implant','E',true), ('Gingiva for Framework','Implant','A',false),
    ('Glaze and Sandblasting','Extras','E',false), ('Mock Up Cast (Smile Design)','Try-ins & Resin','P',false),
    ('Orthodontic Retainer & Night Guard','Extras','E',false), ('Permanent Resin','Try-ins & Resin','E',false),
    ('PFM Implant','PFM','E',false), ('PFM vm13','PFM','E',false),
    ('PMMA Milled','Try-ins & Resin','E',false), ('PMMA Printed','Try-ins & Resin','P',false),
    ('Print Cast only','Try-ins & Resin','P',false), ('Print Guide only','Try-ins & Resin','P',false),
    ('RPD by Tooth','Removable','E',false), ('RPD Complete Denture','Removable','E',false),
    ('RPD Single Arch','Removable','E',false), ('Scanner Rent','Extras','L',false),
    ('Surgical Guide One Tooth','Try-ins & Resin','P',false), ('Verification Jig copper','Implant','E',false),
    ('Zr Elite Multi Layer','Zirconia','E',true), ('Zr Elite Preshade','Zirconia','E',true),
    ('Zr Multi Layer','Zirconia','E',true), ('Zr Preshade','Zirconia','E',true)
)
UPDATE public.services s SET
    family_id=(SELECT id FROM public.service_families WHERE name_en=a.family ORDER BY created_at,id LIMIT 1),
    catalog_route_id=CASE a.route WHEN 'P' THEN 'ba500000-0000-4000-8000-000000000001'::uuid
                                  WHEN 'E' THEN 'ba500000-0000-4000-8000-000000000002'::uuid END,
    catalog_try_in_route_id=CASE WHEN a.trial THEN 'ba100000-0000-4000-8000-000000000001'::uuid END,
    catalog_route_kind=CASE a.route WHEN 'A' THEN 'add_on' WHEN 'L' THEN 'logistics' ELSE 'production' END
FROM assignments a WHERE s.name=a.name;

DO $$
DECLARE definition text := pg_get_functiondef('public.initialize_mixed_try_in_job()'::regprocedure);
BEGIN
    IF strpos(definition,'WHERE i.order_id=item_order;')=0 THEN RAISE EXCEPTION 'Unexpected mixed route initialization'; END IF;
    EXECUTE replace(definition,'WHERE i.order_id=item_order;',
        $sql$WHERE i.order_id=item_order AND (s.catalog_route_kind IS DISTINCT FROM 'add_on' OR s.milling_price>0);$sql$);
END;
$$;

NOTIFY pgrst, 'reload schema';
COMMIT;
