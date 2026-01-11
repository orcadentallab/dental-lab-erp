import * as XLSX from 'xlsx';
import type { Doctor, Service, Order, Transaction } from '../services/db';
import { generateUUID } from './utils';

// Helper to parse Excel date to ISO string
function parseDate(value: any): string {
    if (!value) return new Date().toISOString().split('T')[0];

    // If it's already a date object
    if (value instanceof Date) {
        return value.toISOString().split('T')[0];
    }

    // If it's a number (Excel date serial number)
    if (typeof value === 'number') {
        const date = XLSX.SSF.parse_date_code(value);
        return `${date.y}-${String(date.m).padStart(2, '0')}-${String(date.d).padStart(2, '0')}`;
    }

    // If it's a string, try to parse it
    if (typeof value === 'string') {
        // Try ISO format
        if (value.match(/^\d{4}-\d{2}-\d{2}/)) {
            return value.split('T')[0];
        }
        // Try other formats
        const date = new Date(value);
        if (!isNaN(date.getTime())) {
            return date.toISOString().split('T')[0];
        }
    }

    return new Date().toISOString().split('T')[0];
}

// Helper to clean string values
function cleanString(value: any): string {
    if (value === null || value === undefined) return '';
    return String(value).trim();
}

// Helper to parse number
function parseNumber(value: any): number {
    if (value === null || value === undefined) return 0;
    const num = parseFloat(String(value).replace(/,/g, ''));
    return isNaN(num) ? 0 : num;
}

// Import Doctors from Excel
export function importDoctorsFromExcel(file: File): Promise<Doctor[]> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const data = new Uint8Array(e.target?.result as ArrayBuffer);
                const workbook = XLSX.read(data, { type: 'array' });

                // Get first sheet
                const sheetName = workbook.SheetNames[0];
                const worksheet = workbook.Sheets[sheetName];
                const jsonData = XLSX.utils.sheet_to_json(worksheet);

                const doctors: Doctor[] = jsonData.map((row: any, index: number) => {
                    // Flexible column mapping - try different possible column names
                    const name = cleanString(row['اسم الطبيب'] || row['الاسم'] || row['name'] || row['Name']);
                    const phone = cleanString(row['الهاتف'] || row['تليفون'] || row['phone'] || row['Phone'] || row['موبايل']);
                    const phone2 = cleanString(row['هاتف 2'] || row['الهاتف 2'] || row['phone2'] || row['Phone2'] || row['تليفون 2'] || '');
                    const address = cleanString(row['العنوان'] || row['address'] || row['Address'] || '');
                    const doctorCode = cleanString(row['كود الطبيب'] || row['الكود'] || row['doctor_code'] || row['DoctorCode'] || row['code'] || `DR${index + 1}`);
                    const representativeName = cleanString(row['اسم المندوب'] || row['المندوب'] || row['representative_name'] || row['RepresentativeName'] || '');
                    const representativeId = row['representative_id'] || row['RepresentativeId'] || null;

                    if (!name) {
                        throw new Error(`الصف ${index + 2}: اسم الطبيب مطلوب`);
                    }

                    return {
                        id: generateUUID(),
                        name,
                        phone: phone || 'غير محدد',
                        phone2: phone2 || undefined,
                        address: address || 'غير محدد',
                        doctorCode: doctorCode.toUpperCase(),
                        representativeName: representativeName || 'غير محدد',
                        representativeId: representativeId || undefined
                    } as Doctor;
                });

                resolve(doctors);
            } catch (error: any) {
                reject(new Error(`خطأ في قراءة ملف Excel: ${error.message}`));
            }
        };
        reader.onerror = () => reject(new Error('فشل قراءة الملف'));
        reader.readAsArrayBuffer(file);
    });
}

// Import Services from Excel
export function importServicesFromExcel(file: File): Promise<Service[]> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const data = new Uint8Array(e.target?.result as ArrayBuffer);
                const workbook = XLSX.read(data, { type: 'array' });

                const sheetName = workbook.SheetNames[0];
                const worksheet = workbook.Sheets[sheetName];
                const jsonData = XLSX.utils.sheet_to_json(worksheet);

                const services: Service[] = jsonData.map((row: any, index: number) => {
                    const name = cleanString(row['اسم الخدمة'] || row['الاسم'] || row['name'] || row['Name'] || row['الخدمة']);
                    const sellingPrice = parseNumber(row['سعر البيع'] || row['سعر المبيعة'] || row['selling_price'] || row['SellingPrice'] || row['price']);
                    const costPrice = parseNumber(row['سعر التكلفة'] || row['التكلفة'] || row['cost_price'] || row['CostPrice'] || row['cost']);
                    const millingPrice = parseNumber(row['سعر الخراطة'] || row['milling_price'] || row['MillingPrice'] || row['خراطة'] || 0);

                    if (!name) {
                        throw new Error(`الصف ${index + 2}: اسم الخدمة مطلوب`);
                    }

                    return {
                        id: generateUUID(),
                        name,
                        sellingPrice: sellingPrice || 0,
                        costPrice: costPrice || 0,
                        millingPrice: millingPrice || 0
                    } as Service;
                });

                resolve(services);
            } catch (error: any) {
                reject(new Error(`خطأ في قراءة ملف Excel: ${error.message}`));
            }
        };
        reader.onerror = () => reject(new Error('فشل قراءة الملف'));
        reader.readAsArrayBuffer(file);
    });
}

// Import Orders from Excel
export function importOrdersFromExcel(file: File, doctors: Doctor[]): Promise<Order[]> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const data = new Uint8Array(e.target?.result as ArrayBuffer);
                const workbook = XLSX.read(data, { type: 'array' });

                const sheetName = workbook.SheetNames[0];
                const worksheet = workbook.Sheets[sheetName];
                const jsonData = XLSX.utils.sheet_to_json(worksheet);

                const orders: Order[] = jsonData.map((row: any, index: number) => {
                    // Find doctor - PRIORITIZE CODE over name
                    const doctorCode = cleanString(row['كود الطبيب'] || row['doctor_code'] || row['DoctorCode'] || row['الكود']);
                    const doctorName = cleanString(row['اسم الطبيب'] || row['الطبيب'] || row['doctor_name'] || row['DoctorName']);
                    let doctorId = '';
                    let foundDoctor: Doctor | undefined;

                    // Step 1: Try to find by CODE first (primary identifier)
                    if (doctorCode) {
                        foundDoctor = doctors.find(d =>
                            d.doctorCode?.toUpperCase() === doctorCode.toUpperCase()
                        );
                    }

                    // Step 2: If no code match, try by NAME (fallback)
                    if (!foundDoctor && doctorName) {
                        foundDoctor = doctors.find(d => d.name === doctorName);
                    }

                    if (foundDoctor) {
                        doctorId = foundDoctor.id;
                    }

                    if (!doctorId) {
                        const identifier = doctorCode || doctorName || 'غير معروف';
                        throw new Error(`الصف ${index + 2}: لم يتم العثور على الطبيب (${identifier})`);
                    }

                    const patientName = cleanString(row['اسم المريض'] || row['المريض'] || row['patient_name'] || row['PatientName']);
                    const caseId = cleanString(row['رقم الحالة'] || row['كود الحالة'] || row['case_id'] || row['CaseId'] || `CASE-${Date.now()}-${index}`);

                    // Parse items (could be JSON string or separate columns)
                    let items: any[] = [];
                    try {
                        const itemsStr = row['العناصر'] || row['items'] || row['Items'] || '[]';
                        if (typeof itemsStr === 'string') {
                            items = JSON.parse(itemsStr);
                        } else if (Array.isArray(itemsStr)) {
                            items = itemsStr;
                        }
                    } catch {
                        // If parsing fails, create a simple item
                        const serviceName = cleanString(row['الخدمة'] || row['service'] || row['Service'] || 'خدمة غير محددة');
                        const price = parseNumber(row['السعر'] || row['price'] || row['Price'] || 0);
                        items = [{
                            serviceType: serviceName,
                            teethNumbers: [],
                            price: price || 0
                        }];
                    }

                    const totalPrice = parseNumber(row['السعر الكلي'] || row['إجمالي السعر'] || row['total_price'] || row['TotalPrice'] || row['السعر']);
                    const cost = parseNumber(row['التكلفة'] || row['cost'] || row['Cost'] || totalPrice);
                    const discount = parseNumber(row['الخصم'] || row['discount'] || row['Discount'] || 0);
                    const shade = cleanString(row['اللون'] || row['shade'] || row['Shade'] || 'A1');
                    const status = cleanString(row['الحالة'] || row['status'] || row['Status'] || 'New Case');
                    const deliveryDate = parseDate(row['تاريخ التسليم'] || row['delivery_date'] || row['DeliveryDate'] || row['التاريخ']);
                    const priority = cleanString(row['الأولوية'] || row['priority'] || row['Priority'] || 'Normal') as 'Normal' | 'Urgent';

                    return {
                        id: generateUUID(),
                        caseId,
                        doctorId,
                        patientName: patientName || 'غير محدد',
                        items: items || [],
                        discount: discount || 0,
                        totalPrice: totalPrice || 0,
                        shade: shade || 'A1',
                        status: status as any || 'New Case',
                        deliveryDate,
                        cost: cost || 0,
                        priority: priority || 'Normal',
                        createdAt: new Date().toISOString()
                    } as Order;
                });

                resolve(orders);
            } catch (error: any) {
                reject(new Error(`خطأ في قراءة ملف Excel: ${error.message}`));
            }
        };
        reader.onerror = () => reject(new Error('فشل قراءة الملف'));
        reader.readAsArrayBuffer(file);
    });
}

// Import Transactions from Excel
export function importTransactionsFromExcel(file: File): Promise<Transaction[]> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const data = new Uint8Array(e.target?.result as ArrayBuffer);
                const workbook = XLSX.read(data, { type: 'array' });

                const sheetName = workbook.SheetNames[0];
                const worksheet = workbook.Sheets[sheetName];
                const jsonData = XLSX.utils.sheet_to_json(worksheet);

                const transactions: Transaction[] = jsonData.map((row: any, index: number) => {
                    const type = cleanString(row['النوع'] || row['type'] || row['Type'] || 'expense').toLowerCase();
                    const amount = parseNumber(row['المبلغ'] || row['amount'] || row['Amount']);
                    const category = cleanString(row['الفئة'] || row['category'] || row['Category'] || 'عام');
                    const date = parseDate(row['التاريخ'] || row['date'] || row['Date']);
                    const description = cleanString(row['الوصف'] || row['description'] || row['Description'] || '');

                    if (!amount || amount <= 0) {
                        throw new Error(`الصف ${index + 2}: المبلغ مطلوب`);
                    }

                    return {
                        id: generateUUID(),
                        type: (type === 'income' || type === 'دخل' || type === 'ايراد') ? 'income' : 'expense',
                        amount,
                        category,
                        date,
                        description: description || 'معاملة مالية',
                        isRegistered: false
                    } as Transaction;
                });

                resolve(transactions);
            } catch (error: any) {
                reject(new Error(`خطأ في قراءة ملف Excel: ${error.message}`));
            }
        };
        reader.onerror = () => reject(new Error('فشل قراءة الملف'));
        reader.readAsArrayBuffer(file);
    });
}
