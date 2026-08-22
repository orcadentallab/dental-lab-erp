-- Rename the stages to the words the lab actually says.
--
-- The first names came from RESPONSIBLE_STAGE in src/constants/issueCauses.ts,
-- which calls milling "الفرز". The owner did not recognise it on the route
-- editor -- and he is the one who reads this screen every day. In his own
-- description of the process he wrote "milling + sentering", then "الفينش
-- والستين والجليز والqc وبعده الباكيجينج". Those are the words the floor uses,
-- so those are the words on the screen.
--
-- Only name_ar changes. The `code` values are untouched: they are what joins
-- the existing issue-cause data to stage runs, and renaming them would break
-- that link for no benefit.

BEGIN;

UPDATE public.production_stages SET name_ar = 'التصميم'                  WHERE code = 'design';
UPDATE public.production_stages SET name_ar = 'طباعة الكاست'             WHERE code = 'cast_print';
UPDATE public.production_stages SET name_ar = 'الميلينج (الفرز)'          WHERE code = 'milling';
UPDATE public.production_stages SET name_ar = 'السنترة'                  WHERE code = 'sintering';
UPDATE public.production_stages SET name_ar = 'الفينش (التشطيب)'          WHERE code = 'finish';
UPDATE public.production_stages SET name_ar = 'الستين'                   WHERE code = 'staining';
UPDATE public.production_stages SET name_ar = 'الجليز'                   WHERE code = 'glaze';
UPDATE public.production_stages SET name_ar = 'المراجعة النهائية (QC)'    WHERE code = 'qc';
UPDATE public.production_stages SET name_ar = 'الباكيجينج (التغليف)'      WHERE code = 'packaging';
UPDATE public.production_stages SET name_ar = 'الشحن والتسليم'            WHERE code = 'shipping';
UPDATE public.production_stages SET name_ar = 'عند الطبيب (تراي إن)'      WHERE code = 'doctor_review';
UPDATE public.production_stages SET name_ar = 'حالة كاملة عند معمل خارجي'  WHERE code = 'external_full';

-- A one-line description shown under each stage in the editor, so nobody has
-- to guess what a stage covers before ticking or unticking it.
ALTER TABLE public.production_stages
    ADD COLUMN IF NOT EXISTS description_ar TEXT;

UPDATE public.production_stages SET description_ar = 'المصمم بيعمل ملف التصميم على الكمبيوتر'
 WHERE code = 'design';
UPDATE public.production_stages SET description_ar = 'طباعة موديل الحالة على طابعة الـ 3D'
 WHERE code = 'cast_print';
UPDATE public.production_stages SET description_ar = 'فرز الوحدة من الديسك على ماكينة الميلينج'
 WHERE code = 'milling';
UPDATE public.production_stages SET description_ar = 'حرق الزيركون في الفرن بعد الميلينج'
 WHERE code = 'sintering';
UPDATE public.production_stages SET description_ar = 'تشطيب وتجهيز الوحدة قبل اللون'
 WHERE code = 'finish';
UPDATE public.production_stages SET description_ar = 'ضبط لون الوحدة — مش كل خدمة بتحتاجها'
 WHERE code = 'staining';
UPDATE public.production_stages SET description_ar = 'الجليز والحرقة الأخيرة'
 WHERE code = 'glaze';
UPDATE public.production_stages SET description_ar = 'مراجعة الحالة قبل ما تخرج — بوابة نجاح أو رسوب'
 WHERE code = 'qc';
UPDATE public.production_stages SET description_ar = 'تغليف الحالة وتجهيزها للتسليم'
 WHERE code = 'packaging';
UPDATE public.production_stages SET description_ar = 'تسليم الحالة للطبيب عن طريق شركة الشحن'
 WHERE code = 'shipping';
UPDATE public.production_stages SET description_ar = 'الحالة عند الطبيب للتجربة — الوقت ده مش محسوب علينا'
 WHERE code = 'doctor_review';
UPDATE public.production_stages SET description_ar = 'الحالة بتخرج بالكامل لمعمل خارجي — الوضع القديم'
 WHERE code = 'external_full';

COMMIT;
