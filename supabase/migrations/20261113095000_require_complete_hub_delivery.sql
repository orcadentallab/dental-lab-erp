BEGIN;
DO $$
DECLARE
    definition text:=pg_get_functiondef('public.confirm_shipping_request(uuid,text,timestamptz,text,numeric,uuid)'::regprocedure);
    anchor text:='    response:=public.confirm_shipment_delivery(p_id,p_photo,p_at,p_notes);';
BEGIN
    IF strpos(definition,anchor)=0 THEN RAISE EXCEPTION 'Unexpected shipment confirmation definition'; END IF;
    EXECUTE replace(definition,anchor,anchor||$patch$
    IF trip.previous_shipping_leg IS NOT NULL AND jsonb_array_length(coalesce(response->'orders_skipped','[]'::jsonb))>0 THEN
        RAISE EXCEPTION 'المرحلة الأخيرة لسه مفتوحة. راجع الحالات اللي عليها مشكلة أو اتسجل تسليمها قبل كده';
    END IF;$patch$);
END $$;
COMMIT;
