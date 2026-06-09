const statement1 = [
    { caseId: 'CASE-1770402907834-56', patient: 'وجيهه عبد الله', date: '2026-02-06', price: 750 },
    { caseId: 'CASE-1770402907833-24', patient: 'ندي محمد', date: '2026-02-06', price: 750 },
    { caseId: 'CASE-1770402907831-3', patient: 'نازله', date: '2026-02-06', price: 750 },
    { caseId: '1019-100226-002', patient: 'محمد حامد', date: '2026-02-12', price: 750 },
    { caseId: '1019-100226-001', patient: 'احمد صالح', date: '2026-02-12', price: 1500 },
    { caseId: '1019-150226-001', patient: 'محمد سند', date: '2026-02-18', price: 750 },
    { caseId: '1019-2502-2036', patient: 'سعاد', date: '2026-02-28', price: 2250 },
    { caseId: '1019-2502-1336', patient: 'شيماء محمد', date: '2026-02-28', price: 750 },
    { caseId: '1019-2602-2029', patient: 'احمد نبيل', date: '2026-03-01', price: 750 },
    { caseId: '1019-2602-1208', patient: 'داليا صديق', date: '2026-03-01', price: 750 },
    { caseId: '1019-2602-1206', patient: 'محمد ابراهيم', date: '2026-03-01', price: 750 },
    { caseId: '1019-2602-1147', patient: 'محمد حمادة', date: '2026-03-01', price: 750 },
    { caseId: '1019-1715-2802-1019', patient: 'ايمان', date: '2026-03-03', price: 1500 },
    { caseId: '1019-1713-2802-1019', patient: 'عبد العاطى', date: '2026-03-03', price: 750 },
    { caseId: '1019-1712-2802-1019', patient: 'جورج صامويل', date: '2026-03-03', price: 750 },
    { caseId: '1019-0103-1352', patient: 'نعمة يوسف', date: '2026-03-04', price: 1000 },
    { caseId: '1019-0403-1435', patient: 'محمد مصطفى', date: '2026-03-07', price: 900 },
    { caseId: '1019-0703-1543', patient: 'وائل', date: '2026-03-08', price: 900 },
    { caseId: '1019-0703-1540', patient: 'داليا', date: '2026-03-08', price: 750 },
    { caseId: '1019-1203-1436', patient: 'ريهام أحمد', date: '2026-03-15', price: 1500 },
    { caseId: '1019-1203-1316', patient: 'نور عزت', date: '2026-03-15', price: 750 },
    { caseId: '1019-1203-1314', patient: 'عمر', date: '2026-03-15', price: 750 },
    { caseId: '1019-1850-1403-1019', patient: 'احمد عمرو نصار', date: '2026-03-17', price: 750 },
    { caseId: '1019-2126-1603-1019', patient: 'حازم فاروق', date: '2026-03-19', price: 750 },
    { caseId: '1019-1351-1803-1019', patient: 'حازم عبد القادر', date: '2026-03-23', price: 750 },
    { caseId: '1019-1349-1803-1019', patient: 'سهير أحمد', date: '2026-03-23', price: 750 },
    { caseId: '1019-2015-2303-1019', patient: 'ياسمين', date: '2026-03-26', price: 2000 },
    { caseId: '1019-1604-2303-1019', patient: 'هدى', date: '2026-03-26', price: 750 },
    { caseId: '1019-1355-2503-1019', patient: 'محمد كريم', date: '2026-03-28', price: 750 },
    { caseId: '1019-1404-2503-1019', patient: 'عبد الرحمن وائل', date: '2026-03-30', price: 750 },
    { caseId: '1019-1359-2503-1019', patient: 'وائل سعيد', date: '2026-03-30', price: 750 },
    { caseId: '1019-1357-2503-1019', patient: 'شريف يحيى', date: '2026-03-30', price: 750 },
    { caseId: '1019-2216-2403-1019', patient: 'ليلى', date: '2026-03-30', price: 1500 },
    { caseId: '1019-2136-2603-1019', patient: 'مرينا', date: '2026-03-31', price: 750 },
    { caseId: '1019-1948-2503-1019', patient: 'حنين أحمد', date: '2026-03-31', price: 750 },
    { caseId: '1019-2043-2803-1019', patient: 'منه الله', date: '2026-04-01', price: 750 }
];

let sum = 0;
statement1.forEach((c, idx) => {
    sum += c.price;
    console.log(`${idx + 1}. ${c.patient}: ${c.price} -> Running sum: ${sum}`);
});
