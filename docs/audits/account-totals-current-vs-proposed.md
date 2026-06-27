# Account Totals: Current vs Proposed

Read-only reconciliation. Targeted cleanup and allocation are simulated only.

## A) Executive Summary

- Total official balances: **463,142.00**
- Total active obligations: **2,316,447.00**
- Current obligation balance before cleanup: **474,857.00**
- Total current difference: **11,715.00**
- Targeted cleanup impact: **5,540.00**
- Proposed allocation impact: **341,567.00**
- Remaining difference after proposed steps: **-335,392.00**
- Entities analyzed: **137**
- Accounts matching official now: **103**
- Accounts with current difference: **34**
- Accounts fixed by targeted cleanup: **0**
- Accounts fixed by allocation after cleanup: **8**
- Accounts still different after cleanup/allocation preview: **52**

Protected counts observed:
- account_credits: 0
- allocation_events: 0
- financial_exception_reviews: 0
- financial_obligations: 1536
- payment_allocations: 1309
- transactions: 794

## B) Entity Summary Table

| entity_type | entity_name | official | active obligations | cleanup | clean allocation | after cleanup+allocation | final difference | flags |
|---|---|---:|---:|---:|---:|---:|---:|---|
| external_lab | Allstars | 62,467.00 | 627,177.00 | 0.00 | 52,177.00 | 0.00 | -62,467.00 | issue_settlement, manual_review |
| external_lab | AB Lab | 48,610.00 | 173,735.00 | 5,540.00 | 38,225.00 | 0.00 | -48,610.00 | issue_non_final_payable, issue_settlement, manual_review |
| doctor | سمارت دنتل سنتر - د حازم البلتاجى | 79,625.00 | 109,300.00 | 0.00 | 33,300.00 | 42,700.00 | -36,925.00 | manual_review |
| external_lab | Dr.M Lab | 24,550.00 | 56,280.00 | 0.00 | 29,070.00 | 0.00 | -24,550.00 | issue_settlement, supplier_overpayment, manual_review |
| doctor | دنتال جاليري | 26,400.00 | 49,300.00 | 0.00 | 22,900.00 | 3,500.00 | -22,900.00 | manual_review |
| doctor | احمد شلبى | 13,950.00 | 39,600.00 | 0.00 | 12,450.00 | 0.00 | -13,950.00 | credit_candidate, manual_review |
| doctor | فتحي فوزي | 13,500.00 | 35,050.00 | 0.00 | 13,500.00 | 0.00 | -13,500.00 | credit_candidate, manual_review |
| doctor | خالد العامري | 13,450.00 | 37,600.00 | 0.00 | 12,500.00 | 0.00 | -13,450.00 | credit_candidate, manual_review |
| doctor | محمد حمدى | 11,850.00 | 25,650.00 | 0.00 | 11,850.00 | 0.00 | -11,850.00 | credit_candidate, manual_review |
| doctor | الشامي | 11,700.00 | 14,150.00 | 0.00 | 3,000.00 | 0.00 | -11,700.00 | credit_candidate, manual_review |
| doctor | دنتاليا د احمد جمال | 10,650.00 | 78,850.00 | 0.00 | 17,450.00 | 0.00 | -10,650.00 | credit_candidate, manual_review |
| doctor | سليمان القصر العينى | 9,150.00 | 23,150.00 | 0.00 | 9,150.00 | 0.00 | -9,150.00 | credit_candidate, manual_review |
| doctor | محمد ايهاب | 8,000.00 | 35,300.00 | 0.00 | 8,000.00 | 0.00 | -8,000.00 | credit_candidate, manual_review |
| doctor | بلال موافى | 6,300.00 | 13,300.00 | 0.00 | 6,300.00 | 0.00 | -6,300.00 | credit_candidate, manual_review |
| doctor | انس طارق | 5,650.00 | 25,050.00 | 0.00 | 5,650.00 | 0.00 | -5,650.00 | credit_candidate, manual_review |
| doctor | شريف | 7,500.00 | 3,000.00 | 0.00 | 0.00 | 3,000.00 | -4,500.00 | manual_review |
| doctor | حاتم الدسوقى | 4,050.00 | 86,650.00 | 0.00 | 4,050.00 | 0.00 | -4,050.00 | credit_candidate, manual_review |
| doctor | مصطفى القصر العينى | 5,500.00 | 9,250.00 | 0.00 | 3,750.00 | 1,750.00 | -3,750.00 | manual_review |
| doctor | عيادة ضحكة | 3,700.00 | 14,950.00 | 0.00 | 3,700.00 | 0.00 | -3,700.00 | credit_candidate, manual_review |
| doctor | اسلام سيوى | 3,700.00 | 21,050.00 | 0.00 | 3,700.00 | 0.00 | -3,700.00 | credit_candidate, manual_review |
| doctor | مصطفي الفطايري | 3,000.00 | 10,200.00 | 0.00 | 3,000.00 | 0.00 | -3,000.00 | credit_candidate, manual_review |
| doctor | سالي | -1,950.00 | 7,500.00 | 0.00 | 0.00 | 0.00 | 1,950.00 | credit_candidate, manual_review |
| doctor | احمد فراج | 1,900.00 | 33,100.00 | 0.00 | 1,900.00 | 0.00 | -1,900.00 | credit_candidate, manual_review |
| doctor | مركز شفاء | 1,650.00 | 17,200.00 | 0.00 | 1,650.00 | 0.00 | -1,650.00 | credit_candidate, manual_review |
| doctor | لؤى قدرى | 1,500.00 | 0.00 | 0.00 | 0.00 | 0.00 | -1,500.00 | manual_review |
| doctor | محمد حسن | 1,400.00 | 23,750.00 | 0.00 | 1,400.00 | 0.00 | -1,400.00 | credit_candidate, manual_review |
| doctor | محمد ناجى | 1,350.00 | 19,700.00 | 0.00 | 1,350.00 | 0.00 | -1,350.00 | credit_candidate, manual_review |
| doctor | ممدوح | 1,200.00 | 5,950.00 | 0.00 | 1,200.00 | 0.00 | -1,200.00 | credit_candidate, manual_review |
| doctor | ايهم تركاوي | 1,550.00 | 3,750.00 | 0.00 | 2,200.00 | 350.00 | -1,200.00 | manual_review |
| doctor | محمد مصطفى سليم | 860.00 | 4,860.00 | 0.00 | 860.00 | 0.00 | -860.00 | credit_candidate, manual_review |
| doctor | محمد سبع | 750.00 | 4,450.00 | 0.00 | 750.00 | 0.00 | -750.00 | credit_candidate, manual_review |
| doctor | عبدالله خليفة العاشر | 750.00 | 26,700.00 | 0.00 | 750.00 | 0.00 | -750.00 | credit_candidate, manual_review |
| doctor | احمد شلتوت | 750.00 | 1,750.00 | 0.00 | 750.00 | 0.00 | -750.00 | credit_candidate, manual_review |
| doctor | محمد قمر | 1,500.00 | 750.00 | 0.00 | 0.00 | 750.00 | -750.00 | manual_review |
| doctor | غادة الصيفى | 750.00 | 9,650.00 | 0.00 | 9,650.00 | 0.00 | -750.00 | manual_review |
| doctor | حسام جابر  | 9,000.00 | 8,250.00 | 0.00 | 0.00 | 8,250.00 | -750.00 | manual_review |
| doctor | محمد الدسوقي | -750.00 | 0.00 | 0.00 | 0.00 | 0.00 | 750.00 | credit_candidate, manual_review |
| doctor | ابو صالح | -520.00 | 11,550.00 | 0.00 | 0.00 | 0.00 | 520.00 | credit_candidate, manual_review |
| doctor | صباح | 500.00 | 10,500.00 | 0.00 | 500.00 | 0.00 | -500.00 | credit_candidate, manual_review |
| doctor | إبراهيم الجوهرى | 6,000.00 | 5,550.00 | 0.00 | 0.00 | 5,550.00 | -450.00 | manual_review |
| doctor | محمد احمد حسن | -350.00 | 5,500.00 | 0.00 | 0.00 | 0.00 | 350.00 | credit_candidate, manual_review |
| doctor | بتول احمد | -250.00 | 3,750.00 | 0.00 | 0.00 | 0.00 | 250.00 | credit_candidate, manual_review |
| doctor | ايه يوسف كريستال وايت | 225.00 | 1,200.00 | 0.00 | 225.00 | 0.00 | -225.00 | credit_candidate, manual_review |
| doctor | احمد مازن | -225.00 | 31,125.00 | 0.00 | 0.00 | 0.00 | 225.00 | credit_candidate, manual_review |
| doctor | محمد جلال | -200.00 | 2,250.00 | 0.00 | 0.00 | 0.00 | 200.00 | credit_candidate, manual_review |
| doctor | خالد قصر العيني | -200.00 | 800.00 | 0.00 | 0.00 | 0.00 | 200.00 | credit_candidate, manual_review |
| doctor | عماد الحواوشي | 200.00 | 11,200.00 | 0.00 | 200.00 | 0.00 | -200.00 | credit_candidate, manual_review |
| doctor | رسمى محمد | 200.00 | 750.00 | 0.00 | 750.00 | 0.00 | -200.00 | credit_candidate, manual_review |
| doctor | مازن رضا | 200.00 | 1,400.00 | 0.00 | 200.00 | 0.00 | -200.00 | credit_candidate, manual_review |
| doctor | عماد انور | 150.00 | 16,150.00 | 0.00 | 150.00 | 0.00 | -150.00 | credit_candidate, manual_review |
| doctor | عبده ناصف | 150.00 | 5,000.00 | 0.00 | 0.00 | 0.00 | -150.00 | credit_candidate, manual_review |
| doctor | عليا الديري | -150.00 | 7,350.00 | 0.00 | 0.00 | 0.00 | 150.00 | credit_candidate, manual_review |
| doctor | جودي السوريه | 0.00 | 10,700.00 | 0.00 | 0.00 | 0.00 | 0.00 | credit_candidate, manual_review |
| doctor | اكاديمة ديجيتال امبلانت | 0.00 | 6,000.00 | 0.00 | 0.00 | 0.00 | 0.00 | credit_candidate, manual_review |
| doctor | محمد سعيد فرج | 0.00 | 10,850.00 | 0.00 | 0.00 | 0.00 | 0.00 | credit_candidate, manual_review |
| external_lab | EZ Lab | 0.00 | 42,370.00 | 0.00 | 4,610.00 | 0.00 | 0.00 | settlement_dispute, manual_review |
| doctor | عيادة أسناني د.مصطفي خليفة | 0.00 | 2,000.00 | 0.00 | 0.00 | 0.00 | 0.00 | credit_candidate, manual_review |
| doctor | رامي شوشه | 0.00 | 5,100.00 | 0.00 | 0.00 | 0.00 | 0.00 | credit_candidate, manual_review |
| doctor | مي فوزي | 0.00 | 14,100.00 | 0.00 | 0.00 | 0.00 | 0.00 | credit_candidate, manual_review |
| doctor | بدر الصانع | 0.00 | 4,150.00 | 0.00 | 0.00 | 0.00 | 0.00 | credit_candidate, manual_review |
| doctor | عدي حمزه | 0.00 | 6,400.00 | 0.00 | 0.00 | 0.00 | 0.00 | credit_candidate, manual_review |
| doctor | خالد عبدالله | 0.00 | 3,000.00 | 0.00 | 0.00 | 0.00 | 0.00 | credit_candidate, manual_review |
| external_lab | Mostafa Alawy | 0.00 | 1,350.00 | 0.00 | 0.00 | 0.00 | 0.00 | - |
| doctor | الحوشي  | 0.00 | 26,400.00 | 0.00 | 0.00 | 0.00 | 0.00 | credit_candidate, manual_review |
| external_lab | Cairo Implant | 0.00 | 7,100.00 | 0.00 | 0.00 | 0.00 | 0.00 | - |
| doctor | يامن | 0.00 | 17,000.00 | 0.00 | 0.00 | 0.00 | 0.00 | credit_candidate, manual_review |
| doctor | محمد الشعراوى | 0.00 | 6,500.00 | 0.00 | 0.00 | 0.00 | 0.00 | credit_candidate, manual_review |
| doctor | محمد الفاتح | 0.00 | 22,500.00 | 0.00 | 4,650.00 | 0.00 | 0.00 | credit_candidate, manual_review |
| doctor | يزن الخليل | 0.00 | 3,200.00 | 0.00 | 0.00 | 0.00 | 0.00 | credit_candidate, manual_review |
| doctor | ادهم | 0.00 | 600.00 | 0.00 | 0.00 | 0.00 | 0.00 | credit_candidate, manual_review |
| doctor | بلال جامعة الدلتا | 0.00 | 650.00 | 0.00 | 0.00 | 0.00 | 0.00 | credit_candidate, manual_review |
| doctor | متعب | 0.00 | 3,250.00 | 0.00 | 0.00 | 0.00 | 0.00 | credit_candidate, manual_review |
| doctor | عبد الرحمن الوصيف | 0.00 | 1,350.00 | 0.00 | 0.00 | 0.00 | 0.00 | credit_candidate, manual_review |
| doctor | منة الدقن | 0.00 | 2,500.00 | 0.00 | 0.00 | 0.00 | 0.00 | credit_candidate, manual_review |
| doctor | ديما عماد | 0.00 | 21,600.00 | 0.00 | 0.00 | 0.00 | 0.00 | credit_candidate, manual_review |
| doctor | ميرنا رضوان | 2,250.00 | 2,250.00 | 0.00 | 0.00 | 2,250.00 | 0.00 | - |
| doctor | عبد الرحمن الجمل | 0.00 | 6,250.00 | 0.00 | 0.00 | 0.00 | 0.00 | credit_candidate, manual_review |
| doctor | مصطفي علام | 0.00 | 11,400.00 | 0.00 | 0.00 | 0.00 | 0.00 | credit_candidate, manual_review |
| doctor | ابراهيم عبدالمنعم | 0.00 | 56,900.00 | 0.00 | 0.00 | 0.00 | 0.00 | credit_candidate, manual_review |
| doctor | عبدالرحمن الشاعر | 0.00 | 6,500.00 | 0.00 | 0.00 | 0.00 | 0.00 | credit_candidate, manual_review |
| doctor | معتز الخواص | 0.00 | 2,000.00 | 0.00 | 0.00 | 0.00 | 0.00 | credit_candidate, manual_review |
| doctor | خالد ربيع جامعة بدر | 0.00 | 2,700.00 | 0.00 | 0.00 | 0.00 | 0.00 | credit_candidate, manual_review |
| doctor | محمد على | 0.00 | 2,350.00 | 0.00 | 0.00 | 0.00 | 0.00 | credit_candidate, manual_review |
| doctor | يوسف ناصر | 0.00 | 7,500.00 | 0.00 | 0.00 | 0.00 | 0.00 | credit_candidate, manual_review |
| doctor | محمود عبدالرحمن | 0.00 | 9,550.00 | 0.00 | 0.00 | 0.00 | 0.00 | credit_candidate, manual_review |
| doctor | احمد الجمل | 19,600.00 | 19,600.00 | 0.00 | 0.00 | 19,600.00 | 0.00 | - |
| doctor | عيادات عز العرب | 0.00 | 8,300.00 | 0.00 | 0.00 | 0.00 | 0.00 | credit_candidate, manual_review |
| doctor | عيادة i care | 0.00 | 750.00 | 0.00 | 0.00 | 0.00 | 0.00 | credit_candidate, manual_review |
| doctor | تاج د محمود عبدالهادى | 0.00 | 2,550.00 | 0.00 | 0.00 | 0.00 | 0.00 | credit_candidate, manual_review |
| doctor | كمفورت د محمود عبدالهادى | 0.00 | 2,850.00 | 0.00 | 0.00 | 0.00 | 0.00 | credit_candidate, manual_review |
| doctor | كريم عيادة (أورا) | 0.00 | 1,900.00 | 0.00 | 900.00 | 0.00 | 0.00 | credit_candidate, manual_review |
| doctor | محمد مجدى | 0.00 | 18,450.00 | 0.00 | 0.00 | 0.00 | 0.00 | credit_candidate, manual_review |
| doctor | عمر البيه | 0.00 | 13,350.00 | 0.00 | 0.00 | 0.00 | 0.00 | credit_candidate, manual_review |
| doctor | مصطفى جمال | 0.00 | 2,250.00 | 0.00 | 0.00 | 0.00 | 0.00 | credit_candidate, manual_review |
| doctor | محمد عيسى | 0.00 | 2,000.00 | 0.00 | 0.00 | 0.00 | 0.00 | credit_candidate, manual_review |
| doctor | محمد امل | 0.00 | 3,450.00 | 0.00 | 0.00 | 0.00 | 0.00 | credit_candidate, manual_review |
| doctor | احمد الاكيابى | 0.00 | 900.00 | 0.00 | 0.00 | 0.00 | 0.00 | credit_candidate, manual_review |
| doctor | حكيم | 0.00 | 4,150.00 | 0.00 | 0.00 | 0.00 | 0.00 | credit_candidate, manual_review |
| doctor | محمود عيد | 0.00 | 1,400.00 | 0.00 | 0.00 | 0.00 | 0.00 | credit_candidate, manual_review |
| doctor | باسل | 0.00 | 4,500.00 | 0.00 | 0.00 | 0.00 | 0.00 | credit_candidate, manual_review |
| doctor | عمر ايهاب  | 0.00 | 600.00 | 0.00 | 0.00 | 0.00 | 0.00 | credit_candidate, manual_review |
| doctor | محمد سيد عيادة لوفيدا | 1,000.00 | 1,000.00 | 0.00 | 0.00 | 1,000.00 | 0.00 | - |
| doctor | صلاح ابو اليزيد | 0.00 | 600.00 | 0.00 | 0.00 | 0.00 | 0.00 | credit_candidate, manual_review |
| doctor | مركز طله د احمد صبري | 0.00 | 800.00 | 0.00 | 0.00 | 0.00 | 0.00 | credit_candidate, manual_review |
| doctor | احمد العتباني عياده اراك | 0.00 | 950.00 | 0.00 | 0.00 | 0.00 | 0.00 | credit_candidate, manual_review |
| doctor | عمر عنبر | 0.00 | 6,650.00 | 0.00 | 0.00 | 0.00 | 0.00 | credit_candidate, manual_review |
| doctor | سعد الحارثي | 0.00 | 1,300.00 | 0.00 | 0.00 | 0.00 | 0.00 | credit_candidate, manual_review |
| doctor | محمد سيد | 2,550.00 | 2,550.00 | 0.00 | 0.00 | 2,550.00 | 0.00 | - |
| doctor | محمد ابو شاهين | 0.00 | 1,600.00 | 0.00 | 0.00 | 0.00 | 0.00 | credit_candidate, manual_review |
| doctor | عبدالرحمن الاشرم | 0.00 | 8,250.00 | 0.00 | 0.00 | 0.00 | 0.00 | credit_candidate, manual_review |
| doctor | مريم دياب | 0.00 | 2,550.00 | 0.00 | 0.00 | 0.00 | 0.00 | credit_candidate, manual_review |
| doctor | هيا السعيد | 0.00 | 14,600.00 | 0.00 | 1,200.00 | 0.00 | 0.00 | credit_candidate, manual_review |
| doctor | سلمي صلاح | 0.00 | 3,000.00 | 0.00 | 3,000.00 | 0.00 | 0.00 | - |
| doctor | فهد الحمادى | 0.00 | 6,750.00 | 0.00 | 0.00 | 0.00 | 0.00 | credit_candidate, manual_review |
| doctor | ظافر الاسعد | 0.00 | 7,750.00 | 0.00 | 0.00 | 0.00 | 0.00 | credit_candidate, manual_review |
| doctor | محمد سامح | 0.00 | 3,000.00 | 0.00 | 0.00 | 0.00 | 0.00 | credit_candidate, manual_review |
| doctor | عاصم القصر العيني | 0.00 | 1,500.00 | 0.00 | 0.00 | 0.00 | 0.00 | credit_candidate, manual_review |
| doctor | احمد زكرى | 0.00 | 4,900.00 | 0.00 | 0.00 | 0.00 | 0.00 | credit_candidate, manual_review |
| doctor | عبدالله شحاتة | 750.00 | 750.00 | 0.00 | 0.00 | 750.00 | 0.00 | - |
| doctor | رامز رأفت | 0.00 | 400.00 | 0.00 | 0.00 | 0.00 | 0.00 | credit_candidate, manual_review |
| doctor | امجد ثروت | 0.00 | 13,500.00 | 0.00 | 0.00 | 0.00 | 0.00 | credit_candidate, manual_review |
| doctor | يوسف خالد | 0.00 | 600.00 | 0.00 | 0.00 | 0.00 | 0.00 | credit_candidate, manual_review |
| doctor | احمد وجدي  | 9,300.00 | 14,500.00 | 0.00 | 5,200.00 | 9,300.00 | 0.00 | - |
| doctor | اسلام منير | 14,450.00 | 14,450.00 | 0.00 | 0.00 | 14,450.00 | 0.00 | - |
| doctor | محمد سالم - مستقل | 1,500.00 | 1,500.00 | 0.00 | 0.00 | 1,500.00 | 0.00 | - |
| doctor | حافظ ابراهيم | 750.00 | 750.00 | 0.00 | 0.00 | 750.00 | 0.00 | - |
| doctor | فيصل ابراهيم | 0.00 | 6,400.00 | 0.00 | 800.00 | 0.00 | 0.00 | credit_candidate, manual_review |
| doctor | خالد المرسي | 600.00 | 600.00 | 0.00 | 0.00 | 600.00 | 0.00 | - |
| doctor | اشرف سعيد | 2,350.00 | 2,350.00 | 0.00 | 0.00 | 2,350.00 | 0.00 | - |
| doctor | مركز  بيبودنت | 750.00 | 750.00 | 0.00 | 0.00 | 750.00 | 0.00 | - |
| doctor | مسعد  | 2,250.00 | 2,250.00 | 0.00 | 0.00 | 2,250.00 | 0.00 | - |
| doctor | محمد خالد سعد | 0.00 | 3,000.00 | 0.00 | 3,000.00 | 0.00 | 0.00 | - |
| doctor | محمود بهجت | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 | credit_candidate, manual_review |
| doctor | رامي سعيد ابرهيم ابو ليله | 2,200.00 | 2,200.00 | 0.00 | 0.00 | 2,200.00 | 0.00 | - |
| doctor | محمد رمضان | 600.00 | 600.00 | 0.00 | 0.00 | 600.00 | 0.00 | - |
| doctor | ديانا عمرو | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 | - |
| doctor | مركز كيان د محمود النعماني | 1,000.00 | 1,000.00 | 0.00 | 0.00 | 1,000.00 | 0.00 | - |

## C) Accounts With Zero Difference Now

| entity_type | entity_name | current difference | after cleanup | after cleanup+allocation | reason |
|---|---|---:|---:|---:|---|
| doctor | دنتال جاليري | 0.00 | 0.00 | -22,900.00 | already matches official |
| doctor | فتحي فوزي | 0.00 | 0.00 | -13,500.00 | doctor credit candidate after matching obligations |
| doctor | محمد حمدى | 0.00 | 0.00 | -11,850.00 | doctor credit candidate after matching obligations |
| doctor | سليمان القصر العينى | 0.00 | 0.00 | -9,150.00 | doctor credit candidate after matching obligations |
| doctor | محمد ايهاب | 0.00 | 0.00 | -8,000.00 | doctor credit candidate after matching obligations |
| doctor | بلال موافى | 0.00 | 0.00 | -6,300.00 | doctor credit candidate after matching obligations |
| doctor | انس طارق | 0.00 | 0.00 | -5,650.00 | doctor credit candidate after matching obligations |
| doctor | حاتم الدسوقى | 0.00 | 0.00 | -4,050.00 | doctor credit candidate after matching obligations |
| doctor | مصطفى القصر العينى | 0.00 | 0.00 | -3,750.00 | already matches official |
| doctor | عيادة ضحكة | 0.00 | 0.00 | -3,700.00 | doctor credit candidate after matching obligations |
| doctor | اسلام سيوى | 0.00 | 0.00 | -3,700.00 | doctor credit candidate after matching obligations |
| doctor | مصطفي الفطايري | 0.00 | 0.00 | -3,000.00 | doctor credit candidate after matching obligations |
| doctor | احمد فراج | 0.00 | 0.00 | -1,900.00 | doctor credit candidate after matching obligations |
| doctor | مركز شفاء | 0.00 | 0.00 | -1,650.00 | doctor credit candidate after matching obligations |
| doctor | محمد حسن | 0.00 | 0.00 | -1,400.00 | doctor credit candidate after matching obligations |
| doctor | محمد ناجى | 0.00 | 0.00 | -1,350.00 | doctor credit candidate after matching obligations |
| doctor | ممدوح | 0.00 | 0.00 | -1,200.00 | doctor credit candidate after matching obligations |
| doctor | محمد مصطفى سليم | 0.00 | 0.00 | -860.00 | doctor credit candidate after matching obligations |
| doctor | محمد سبع | 0.00 | 0.00 | -750.00 | doctor credit candidate after matching obligations |
| doctor | عبدالله خليفة العاشر | 0.00 | 0.00 | -750.00 | doctor credit candidate after matching obligations |
| doctor | احمد شلتوت | 0.00 | 0.00 | -750.00 | doctor credit candidate after matching obligations |
| doctor | صباح | 0.00 | 0.00 | -500.00 | doctor credit candidate after matching obligations |
| doctor | ايه يوسف كريستال وايت | 0.00 | 0.00 | -225.00 | doctor credit candidate after matching obligations |
| doctor | عماد الحواوشي | 0.00 | 0.00 | -200.00 | doctor credit candidate after matching obligations |
| doctor | مازن رضا | 0.00 | 0.00 | -200.00 | doctor credit candidate after matching obligations |
| doctor | عماد انور | 0.00 | 0.00 | -150.00 | doctor credit candidate after matching obligations |
| doctor | جودي السوريه | 0.00 | 0.00 | 0.00 | doctor credit candidate after matching obligations |
| doctor | اكاديمة ديجيتال امبلانت | 0.00 | 0.00 | 0.00 | doctor credit candidate after matching obligations |
| doctor | محمد سعيد فرج | 0.00 | 0.00 | 0.00 | doctor credit candidate after matching obligations |
| doctor | عيادة أسناني د.مصطفي خليفة | 0.00 | 0.00 | 0.00 | doctor credit candidate after matching obligations |
| doctor | رامي شوشه | 0.00 | 0.00 | 0.00 | doctor credit candidate after matching obligations |
| doctor | مي فوزي | 0.00 | 0.00 | 0.00 | doctor credit candidate after matching obligations |
| doctor | بدر الصانع | 0.00 | 0.00 | 0.00 | doctor credit candidate after matching obligations |
| doctor | عدي حمزه | 0.00 | 0.00 | 0.00 | doctor credit candidate after matching obligations |
| doctor | خالد عبدالله | 0.00 | 0.00 | 0.00 | doctor credit candidate after matching obligations |
| external_lab | Mostafa Alawy | 0.00 | 0.00 | 0.00 | matches official after proposed preview |
| doctor | الحوشي  | 0.00 | 0.00 | 0.00 | doctor credit candidate after matching obligations |
| external_lab | Cairo Implant | 0.00 | 0.00 | 0.00 | matches official after proposed preview |
| doctor | يامن | 0.00 | 0.00 | 0.00 | doctor credit candidate after matching obligations |
| doctor | محمد الشعراوى | 0.00 | 0.00 | 0.00 | doctor credit candidate after matching obligations |
| doctor | يزن الخليل | 0.00 | 0.00 | 0.00 | doctor credit candidate after matching obligations |
| doctor | ادهم | 0.00 | 0.00 | 0.00 | doctor credit candidate after matching obligations |
| doctor | بلال جامعة الدلتا | 0.00 | 0.00 | 0.00 | doctor credit candidate after matching obligations |
| doctor | متعب | 0.00 | 0.00 | 0.00 | doctor credit candidate after matching obligations |
| doctor | عبد الرحمن الوصيف | 0.00 | 0.00 | 0.00 | doctor credit candidate after matching obligations |
| doctor | منة الدقن | 0.00 | 0.00 | 0.00 | doctor credit candidate after matching obligations |
| doctor | ديما عماد | 0.00 | 0.00 | 0.00 | doctor credit candidate after matching obligations |
| doctor | ميرنا رضوان | 0.00 | 0.00 | 0.00 | matches official after proposed preview |
| doctor | عبد الرحمن الجمل | 0.00 | 0.00 | 0.00 | doctor credit candidate after matching obligations |
| doctor | مصطفي علام | 0.00 | 0.00 | 0.00 | doctor credit candidate after matching obligations |
| doctor | ابراهيم عبدالمنعم | 0.00 | 0.00 | 0.00 | doctor credit candidate after matching obligations |
| doctor | عبدالرحمن الشاعر | 0.00 | 0.00 | 0.00 | doctor credit candidate after matching obligations |
| doctor | معتز الخواص | 0.00 | 0.00 | 0.00 | doctor credit candidate after matching obligations |
| doctor | خالد ربيع جامعة بدر | 0.00 | 0.00 | 0.00 | doctor credit candidate after matching obligations |
| doctor | محمد على | 0.00 | 0.00 | 0.00 | doctor credit candidate after matching obligations |
| doctor | يوسف ناصر | 0.00 | 0.00 | 0.00 | doctor credit candidate after matching obligations |
| doctor | محمود عبدالرحمن | 0.00 | 0.00 | 0.00 | doctor credit candidate after matching obligations |
| doctor | احمد الجمل | 0.00 | 0.00 | 0.00 | matches official after proposed preview |
| doctor | عيادات عز العرب | 0.00 | 0.00 | 0.00 | doctor credit candidate after matching obligations |
| doctor | عيادة i care | 0.00 | 0.00 | 0.00 | doctor credit candidate after matching obligations |
| doctor | تاج د محمود عبدالهادى | 0.00 | 0.00 | 0.00 | doctor credit candidate after matching obligations |
| doctor | كمفورت د محمود عبدالهادى | 0.00 | 0.00 | 0.00 | doctor credit candidate after matching obligations |
| doctor | محمد مجدى | 0.00 | 0.00 | 0.00 | doctor credit candidate after matching obligations |
| doctor | عمر البيه | 0.00 | 0.00 | 0.00 | doctor credit candidate after matching obligations |
| doctor | مصطفى جمال | 0.00 | 0.00 | 0.00 | doctor credit candidate after matching obligations |
| doctor | محمد عيسى | 0.00 | 0.00 | 0.00 | doctor credit candidate after matching obligations |
| doctor | محمد امل | 0.00 | 0.00 | 0.00 | doctor credit candidate after matching obligations |
| doctor | احمد الاكيابى | 0.00 | 0.00 | 0.00 | doctor credit candidate after matching obligations |
| doctor | حكيم | 0.00 | 0.00 | 0.00 | doctor credit candidate after matching obligations |
| doctor | محمود عيد | 0.00 | 0.00 | 0.00 | doctor credit candidate after matching obligations |
| doctor | باسل | 0.00 | 0.00 | 0.00 | doctor credit candidate after matching obligations |
| doctor | عمر ايهاب  | 0.00 | 0.00 | 0.00 | doctor credit candidate after matching obligations |
| doctor | محمد سيد عيادة لوفيدا | 0.00 | 0.00 | 0.00 | matches official after proposed preview |
| doctor | صلاح ابو اليزيد | 0.00 | 0.00 | 0.00 | doctor credit candidate after matching obligations |
| doctor | مركز طله د احمد صبري | 0.00 | 0.00 | 0.00 | doctor credit candidate after matching obligations |
| doctor | احمد العتباني عياده اراك | 0.00 | 0.00 | 0.00 | doctor credit candidate after matching obligations |
| doctor | عمر عنبر | 0.00 | 0.00 | 0.00 | doctor credit candidate after matching obligations |
| doctor | سعد الحارثي | 0.00 | 0.00 | 0.00 | doctor credit candidate after matching obligations |
| doctor | محمد سيد | 0.00 | 0.00 | 0.00 | matches official after proposed preview |
| doctor | محمد ابو شاهين | 0.00 | 0.00 | 0.00 | doctor credit candidate after matching obligations |
| doctor | عبدالرحمن الاشرم | 0.00 | 0.00 | 0.00 | doctor credit candidate after matching obligations |
| doctor | مريم دياب | 0.00 | 0.00 | 0.00 | doctor credit candidate after matching obligations |
| doctor | فهد الحمادى | 0.00 | 0.00 | 0.00 | doctor credit candidate after matching obligations |
| doctor | ظافر الاسعد | 0.00 | 0.00 | 0.00 | doctor credit candidate after matching obligations |
| doctor | محمد سامح | 0.00 | 0.00 | 0.00 | doctor credit candidate after matching obligations |
| doctor | عاصم القصر العيني | 0.00 | 0.00 | 0.00 | doctor credit candidate after matching obligations |
| doctor | احمد زكرى | 0.00 | 0.00 | 0.00 | doctor credit candidate after matching obligations |
| doctor | عبدالله شحاتة | 0.00 | 0.00 | 0.00 | matches official after proposed preview |
| doctor | رامز رأفت | 0.00 | 0.00 | 0.00 | doctor credit candidate after matching obligations |
| doctor | امجد ثروت | 0.00 | 0.00 | 0.00 | doctor credit candidate after matching obligations |
| doctor | يوسف خالد | 0.00 | 0.00 | 0.00 | doctor credit candidate after matching obligations |
| doctor | اسلام منير | 0.00 | 0.00 | 0.00 | matches official after proposed preview |
| doctor | محمد سالم - مستقل | 0.00 | 0.00 | 0.00 | matches official after proposed preview |
| doctor | حافظ ابراهيم | 0.00 | 0.00 | 0.00 | matches official after proposed preview |
| doctor | خالد المرسي | 0.00 | 0.00 | 0.00 | matches official after proposed preview |
| doctor | اشرف سعيد | 0.00 | 0.00 | 0.00 | matches official after proposed preview |
| doctor | مركز  بيبودنت | 0.00 | 0.00 | 0.00 | matches official after proposed preview |
| doctor | مسعد  | 0.00 | 0.00 | 0.00 | matches official after proposed preview |
| doctor | محمود بهجت | 0.00 | 0.00 | 0.00 | doctor credit candidate after matching obligations |
| doctor | رامي سعيد ابرهيم ابو ليله | 0.00 | 0.00 | 0.00 | matches official after proposed preview |
| doctor | محمد رمضان | 0.00 | 0.00 | 0.00 | matches official after proposed preview |
| doctor | ديانا عمرو | 0.00 | 0.00 | 0.00 | matches official after proposed preview |
| doctor | مركز كيان د محمود النعماني | 0.00 | 0.00 | 0.00 | matches official after proposed preview |

## D) Accounts Where Cleanup Fixes The Difference

None.

## E) Accounts Where Allocation Fixes/Matches The Balance

| entity_type | entity_name | current difference | after cleanup | after cleanup+allocation | reason |
|---|---|---:|---:|---:|---|
| external_lab | EZ Lab | 4,610.00 | 4,610.00 | 0.00 | settlement/dispute transaction excluded |
| doctor | محمد الفاتح | 4,650.00 | 4,650.00 | 0.00 | doctor credit candidate after matching obligations |
| doctor | كريم عيادة (أورا) | 900.00 | 900.00 | 0.00 | doctor credit candidate after matching obligations |
| doctor | هيا السعيد | 1,200.00 | 1,200.00 | 0.00 | doctor credit candidate after matching obligations |
| doctor | سلمي صلاح | 3,000.00 | 3,000.00 | 0.00 | matches official after proposed preview |
| doctor | احمد وجدي  | 5,200.00 | 5,200.00 | 0.00 | matches official after proposed preview |
| doctor | فيصل ابراهيم | 800.00 | 800.00 | 0.00 | doctor credit candidate after matching obligations |
| doctor | محمد خالد سعد | 3,000.00 | 3,000.00 | 0.00 | matches official after proposed preview |

## F) Accounts Still Different After Cleanup/Allocation

| entity_type | entity_name | current difference | after cleanup | after cleanup+allocation | reason |
|---|---|---:|---:|---:|---|
| external_lab | Allstars | -10,290.00 | -10,290.00 | -62,467.00 | issue settlement excluded from clean FIFO |
| external_lab | AB Lab | -4,845.00 | -10,385.00 | -48,610.00 | supplier issue/non-final normal payable cleanup candidate; issue settlement excluded from clean FIFO |
| doctor | سمارت دنتل سنتر - د حازم البلتاجى | -3,625.00 | -3,625.00 | -36,925.00 | unexplained difference requires review |
| external_lab | Dr.M Lab | 4,520.00 | 4,520.00 | -24,550.00 | issue settlement excluded from clean FIFO; supplier overpayment/manual review |
| doctor | دنتال جاليري | 0.00 | 0.00 | -22,900.00 | already matches official |
| doctor | احمد شلبى | -1,500.00 | -1,500.00 | -13,950.00 | doctor credit candidate after matching obligations |
| doctor | فتحي فوزي | 0.00 | 0.00 | -13,500.00 | doctor credit candidate after matching obligations |
| doctor | خالد العامري | -950.00 | -950.00 | -13,450.00 | doctor credit candidate after matching obligations |
| doctor | محمد حمدى | 0.00 | 0.00 | -11,850.00 | doctor credit candidate after matching obligations |
| doctor | الشامي | -8,700.00 | -8,700.00 | -11,700.00 | doctor credit candidate after matching obligations |
| doctor | دنتاليا د احمد جمال | 6,800.00 | 6,800.00 | -10,650.00 | doctor credit candidate after matching obligations |
| doctor | سليمان القصر العينى | 0.00 | 0.00 | -9,150.00 | doctor credit candidate after matching obligations |
| doctor | محمد ايهاب | 0.00 | 0.00 | -8,000.00 | doctor credit candidate after matching obligations |
| doctor | بلال موافى | 0.00 | 0.00 | -6,300.00 | doctor credit candidate after matching obligations |
| doctor | انس طارق | 0.00 | 0.00 | -5,650.00 | doctor credit candidate after matching obligations |
| doctor | شريف | -4,500.00 | -4,500.00 | -4,500.00 | unexplained difference requires review |
| doctor | حاتم الدسوقى | 0.00 | 0.00 | -4,050.00 | doctor credit candidate after matching obligations |
| doctor | مصطفى القصر العينى | 0.00 | 0.00 | -3,750.00 | already matches official |
| doctor | عيادة ضحكة | 0.00 | 0.00 | -3,700.00 | doctor credit candidate after matching obligations |
| doctor | اسلام سيوى | 0.00 | 0.00 | -3,700.00 | doctor credit candidate after matching obligations |
| doctor | مصطفي الفطايري | 0.00 | 0.00 | -3,000.00 | doctor credit candidate after matching obligations |
| doctor | سالي | 1,950.00 | 1,950.00 | 1,950.00 | doctor credit candidate after matching obligations |
| doctor | احمد فراج | 0.00 | 0.00 | -1,900.00 | doctor credit candidate after matching obligations |
| doctor | مركز شفاء | 0.00 | 0.00 | -1,650.00 | doctor credit candidate after matching obligations |
| doctor | لؤى قدرى | -1,500.00 | -1,500.00 | -1,500.00 | unexplained difference requires review |
| doctor | محمد حسن | 0.00 | 0.00 | -1,400.00 | doctor credit candidate after matching obligations |
| doctor | محمد ناجى | 0.00 | 0.00 | -1,350.00 | doctor credit candidate after matching obligations |
| doctor | ممدوح | 0.00 | 0.00 | -1,200.00 | doctor credit candidate after matching obligations |
| doctor | ايهم تركاوي | 1,000.00 | 1,000.00 | -1,200.00 | unexplained difference requires review |
| doctor | محمد مصطفى سليم | 0.00 | 0.00 | -860.00 | doctor credit candidate after matching obligations |
| doctor | محمد سبع | 0.00 | 0.00 | -750.00 | doctor credit candidate after matching obligations |
| doctor | عبدالله خليفة العاشر | 0.00 | 0.00 | -750.00 | doctor credit candidate after matching obligations |
| doctor | احمد شلتوت | 0.00 | 0.00 | -750.00 | doctor credit candidate after matching obligations |
| doctor | محمد قمر | -750.00 | -750.00 | -750.00 | unexplained difference requires review |
| doctor | غادة الصيفى | 8,900.00 | 8,900.00 | -750.00 | unexplained difference requires review |
| doctor | حسام جابر  | -750.00 | -750.00 | -750.00 | unexplained difference requires review |
| doctor | محمد الدسوقي | 750.00 | 750.00 | 750.00 | doctor credit candidate after matching obligations |
| doctor | ابو صالح | 520.00 | 520.00 | 520.00 | doctor credit candidate after matching obligations |
| doctor | صباح | 0.00 | 0.00 | -500.00 | doctor credit candidate after matching obligations |
| doctor | إبراهيم الجوهرى | -450.00 | -450.00 | -450.00 | unexplained difference requires review |
| doctor | محمد احمد حسن | 350.00 | 350.00 | 350.00 | doctor credit candidate after matching obligations |
| doctor | بتول احمد | 250.00 | 250.00 | 250.00 | doctor credit candidate after matching obligations |
| doctor | ايه يوسف كريستال وايت | 0.00 | 0.00 | -225.00 | doctor credit candidate after matching obligations |
| doctor | احمد مازن | 225.00 | 225.00 | 225.00 | doctor credit candidate after matching obligations |
| doctor | محمد جلال | 200.00 | 200.00 | 200.00 | doctor credit candidate after matching obligations |
| doctor | خالد قصر العيني | 200.00 | 200.00 | 200.00 | doctor credit candidate after matching obligations |
| doctor | عماد الحواوشي | 0.00 | 0.00 | -200.00 | doctor credit candidate after matching obligations |
| doctor | رسمى محمد | 550.00 | 550.00 | -200.00 | doctor credit candidate after matching obligations |
| doctor | مازن رضا | 0.00 | 0.00 | -200.00 | doctor credit candidate after matching obligations |
| doctor | عماد انور | 0.00 | 0.00 | -150.00 | doctor credit candidate after matching obligations |
| doctor | عبده ناصف | -150.00 | -150.00 | -150.00 | doctor credit candidate after matching obligations |
| doctor | عليا الديري | 150.00 | 150.00 | 150.00 | doctor credit candidate after matching obligations |

## G) Reason Breakdown For Remaining Differences

- doctor credit candidate after matching obligations: 39
- unexplained difference requires review: 8
- issue settlement excluded from clean FIFO: 3
- already matches official: 2
- supplier issue/non-final normal payable cleanup candidate: 1
- supplier overpayment/manual review: 1

## H) Final Go/No-Go Recommendation

No-go for broad allocation write.

Conditional go later for a clean subset only, after:
1. Targeted cleanup is approved/applied separately for the exact 15 candidates.
2. Issue settlements, settlement/dispute payments, supplier overpayments, and doctor credit excess remain excluded.
3. A final clean-subset dry run is regenerated and reviewed.