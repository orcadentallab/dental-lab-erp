import * as fs from 'fs';

const statement2 = [
    { caseId: '1019-2043-2803-1019', patient: 'منه الله', date: '01/04/2026', price: 750, isDuplicate: true },
    { caseId: '1019-1211-3103-1019', patient: 'بسمه', date: '03/04/2026', price: 900 },
    { caseId: '1019-1448-3103-1019', patient: 'محمد العادل', date: '04/04/2026', price: 725 },
    { caseId: '1019-1350-0104-1019', patient: 'محمد محمد', date: '05/04/2026', price: 725 },
    { caseId: '1019-2111-0104-1019', patient: 'محمد حسام', date: '06/04/2026', price: 725 },
    { caseId: '1019-2058-0104-1019', patient: 'الاء عاطف', date: '06/04/2026', price: 725 },
    { caseId: '1019-2056-0104-1019', patient: 'عصام بدوى', date: '06/04/2026', price: 1450 },
    { caseId: '1019-2149-3103-1019', patient: 'سامح ممدوح', date: '06/04/2026', price: 725 },
    { caseId: '1019-2147-3103-1019', patient: 'نانسي سمير', date: '06/04/2026', price: 1450 },
    { caseId: '1019-1732-0404-1019', patient: 'فاطمه محمد', date: '07/04/2026', price: 900 },
    { caseId: '1019-1156-0404-1019', patient: 'ساندرا اشرف', date: '07/04/2026', price: 725 },
    { caseId: '1019-1354-0804-1019', patient: 'السيد شاكر', date: '11/04/2026', price: 725 },
    { caseId: '1019-1307-1004-1019', patient: 'شرين يسرى', date: '13/04/2026', price: 900 },
    { caseId: '1019-1841-0904-1019', patient: 'مى سيد', date: '13/04/2026', price: 2175 },
    { caseId: '1019-2124-1504-1019', patient: 'داليا امين', date: '14/04/2026', price: 0, isCancelled: true },
    { caseId: '1019-1311-1304-1019', patient: 'ليلى طلعت', date: '16/04/2026', price: 1450 },
    { caseId: '1019-1503-1504-1019', patient: 'داليا عمار', date: '18/04/2026', price: 725 },
    { caseId: '1019-1501-1504-1019', patient: 'نوريهان محمد', date: '18/04/2026', price: 725 },
    { caseId: '1019-1458-1504-1019', patient: 'ساميه', date: '18/04/2026', price: 725 },
    { caseId: '1019-1454-1504-1019', patient: 'ريم عباس', date: '18/04/2026', price: 725 },
    { caseId: '1019-1453-1504-1019', patient: 'محمد عبد العزيز', date: '18/04/2026', price: 725 },
    { caseId: '1019-1555-1804-1019', patient: 'محمد على', date: '21/04/2026', price: 725 },
    { caseId: '1019-2127-1504-1019', patient: 'داليا امين', date: '21/04/2026', price: 725 },
    { caseId: '1019-2126-1504-1019', patient: 'احمد على', date: '21/04/2026', price: 725 },
    { caseId: '1019-1943-1904-1019', patient: 'ساره محمد', date: '22/04/2026', price: 1450 },
    { caseId: '1019-1941-1904-1019', patient: 'سمر على', date: '22/04/2026', price: 725 },
    { caseId: '1019-2143-2004-1019', patient: 'هدى جودة', date: '23/04/2026', price: 725 },
    { caseId: '1019-2141-2004-1019', patient: 'سمر سمر', date: '23/04/2026', price: 725 },
    { caseId: '1019-2139-2004-1019', patient: 'عبد العزيز', date: '23/04/2026', price: 725 },
    { caseId: '1019-1603-2004-1019', patient: 'مصطفى', date: '23/04/2026', price: 725 },
    { caseId: '1019-2129-2104-192-1019', patient: 'نيفين محمد', date: '24/04/2026', price: 950 },
    { caseId: '1019-2126-2104-1019', patient: 'سالي عبد الحافظ', date: '24/04/2026', price: 725 },
    { caseId: '1019-2123-2104-192-1019', patient: 'فكريه ابراهيم', date: '24/04/2026', price: 750 },
    { caseId: '1019-2120-2104-1019', patient: 'حازم محمد', date: '24/04/2026', price: 725 },
    { caseId: '1019-2117-2104-1019', patient: 'سما كمال', date: '24/04/2026', price: 725 },
    { caseId: '1019-1157-2204-1019', patient: 'عمر يوسف', date: '25/04/2026', price: 725 },
    { caseId: '1019-1348-2304-192-1019', patient: 'مهتاب مسعد', date: '26/04/2026', price: 725 },
    { caseId: '1019-1347-2304-192-1019', patient: 'داليا صديق', date: '26/04/2026', price: 725 },
    { caseId: '1019-1346-2304-1019', patient: 'يمام وائل', date: '26/04/2026', price: 1450 },
    { caseId: '1019-1344-2304-758-1019', patient: 'آيه عبد الغفار', date: '26/04/2026', price: 1450 },
    { caseId: '1019-1342-2304-246-1019', patient: 'منى عبد الحميد', date: '26/04/2026', price: 725 },
    { caseId: '1019-579-260425-1019', patient: 'رينا عواسي', date: '27/04/2026', price: 725 },
    { caseId: '1019-581-260425-1019', patient: 'عبد الرحمن محمد', date: '28/04/2026', price: 1200 },
    { caseId: '1019-580-260425-1019', patient: 'مروة سيد', date: '28/04/2026', price: 725 },
    { caseId: '1019-578-260423-1019', patient: 'تقى كريم', date: '29/04/2026', price: 725 },
    { caseId: '1019-584-260428-1019', patient: 'محمد بحيرى', date: '01/05/2026', price: 725 },
    { caseId: '1019-585-260428-1019', patient: 'ندى أسامه', date: '02/05/2026', price: 725 },
    { caseId: '1019-583-260428-1019', patient: 'وائل سمير', date: '02/05/2026', price: 1450 },
    { caseId: '1019-582-260428-1019', patient: 'نعمات وهبه', date: '02/05/2026', price: 725 }
];

console.log('--- GENERATING UNPAID CASES ---');
const unpaid = statement2.filter(c => !c.isDuplicate && !c.isCancelled);
console.log(`Total unpaid cases: ${unpaid.length}`);

let totalUnpaidSum = 0;
unpaid.forEach((c, idx) => {
    totalUnpaidSum += c.price;
    console.log(`${idx + 1}. Patient: ${c.patient} | Case ID: ${c.caseId} | Date: ${c.date} | Price: ${c.price}`);
});

console.log(`\nTotal sum of unpaid cases: ${totalUnpaidSum} EGP`);
