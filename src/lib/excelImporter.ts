import * as XLSX from 'xlsx';
import type { Doctor, Service, Order, Transaction, Supplier } from '../services/db';
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
export function importOrdersFromExcel(file: File, doctors: Doctor[], suppliers: Supplier[], services: Service[]): Promise<Order[]> {
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
                    // Find doctor
                    const doctorCode = cleanString(row['كود الطبيب'] || row['doctor_code'] || row['DoctorCode'] || row['الكود']);
                    const doctorName = cleanString(row['اسم الطبيب'] || row['الطبيب'] || row['doctor_name'] || row['DoctorName']);
                    let doctorId = '';
                    let foundDoctor: Doctor | undefined;

                    if (doctorCode) {
                        foundDoctor = doctors.find(d => d.doctorCode?.toUpperCase() === doctorCode.toUpperCase());
                    }
                    if (!foundDoctor && doctorName) {
                        foundDoctor = doctors.find(d => d.name === doctorName);
                    }
                    if (foundDoctor) {
                        doctorId = foundDoctor.id;
                    }

                    // Strict requirement: Doctor must exist. If not found, skip or error? 
                    // User wants to import so we throw error to alert them.
                    if (!doctorId) {
                        // Optional: Create a dummy doctor? No, better safe.
                        // But we can fallback to "Unknown" if really needed, but better strictly follow user data.
                        // For now keeping existing error behavior but making it clear.
                        const identifier = doctorCode || doctorName || 'غير معروف';
                        throw new Error(`الصف ${index + 2}: لم يتم العثور على الطبيب (${identifier})`);
                    }

                    const patientName = cleanString(row['اسم المريض'] || row['المريض'] || row['patient_name'] || row['PatientName']);
                    // Generate a unique Case ID if not provided
                    const caseId = cleanString(row['رقم الحالة'] || row['كود الحالة'] || row['case_id'] || row['CaseId'] || `CASE-${Date.now()}-${index}`);

                    // --- ITEM & SUPPLIER/LAB MAPPING ---
                    let items: any[] = [];
                    const serviceName = cleanString(row['الخدمات'] || row['الخدمة'] || row['اسم الخدمة'] || row['Service'] || row['service']);
                    const countColumn = parseNumber(row['عدد الاسنان'] || row['Count'] || row['count'] || row['Quantity'] || 1);
                    const toothCount = countColumn > 0 ? countColumn : 1;

                    // --- EXECUTING LAB (SUPPLIER) LOOKUP ---
                    const supplierName = cleanString(row['المعمل المنفذ'] || row['المعمل'] || row['Executing Lab'] || row['Lab'] || row['Supplier']);
                    let supplierId: string | undefined = undefined;
                    let foundSupplier: Supplier | undefined = undefined;

                    if (supplierName) {
                        foundSupplier = suppliers.find(s => s.name === supplierName || s.name.toLowerCase() === supplierName.toLowerCase());
                        if (foundSupplier) {
                            supplierId = foundSupplier.id;
                        }
                    }

                    // --- ITEM CREATION ---
                    if (serviceName) {
                        const unitPrice = parseNumber(row['السعر'] || row['Unit Price'] || row['price'] || 0);
                        const teethNumbers: string[] = [];
                        for (let i = 1; i <= toothCount; i++) {
                            teethNumbers.push(String(i));
                        }

                        items.push({
                            serviceType: serviceName,
                            teethNumbers: teethNumbers,
                            price: unitPrice
                        });
                    } else {
                        try {
                            const itemsStr = row['العناصر'] || row['items'] || row['Items'] || '[]';
                            if (typeof itemsStr === 'string') {
                                items = JSON.parse(itemsStr);
                            } else if (Array.isArray(itemsStr)) {
                                items = itemsStr;
                            }
                        } catch { }
                    }

                    if (items.length === 0) {
                        // Add default if nothing found? Or allow empty?
                        // Let's add a placeholder if missing to avoid errors, or maybe the user wants it empty.
                        // Order must have items usually.
                    }

                    // --- TOTALS ---
                    // User said: "صافى القيمة" is the total value
                    const netValue = parseNumber(row['صافى القيمة'] || row['Total Value'] || row['Net Value'] || 0);

                    // Calculate from items if netValue is missing
                    const calculatedTotal = items.reduce((sum, item) => sum + (item.price * item.teethNumbers.length), 0);

                    const totalPrice = netValue > 0 ? netValue : calculatedTotal;

                    // --- COST LOGIC (IMPROVED) ---
                    // 1. Try Total Cost from Excel
                    let cost = parseNumber(row['التكلفة'] || row['cost'] || row['Cost'] || row['اجمالي التكلفة'] || row['Total Cost'] || 0);

                    if (cost === 0 && items.length > 0) {
                        // 2. Try Unit Cost from Excel * Count
                        const excelUnitCost = parseNumber(row['سعر الشراء'] || row['Buying Price'] || row['Purchase Price'] || row['سعر المعمل'] || row['Lab Price'] || row['Unit Cost'] || 0);

                        if (excelUnitCost > 0) {
                            cost = excelUnitCost * toothCount;
                        }
                        else if (foundSupplier && serviceName) {
                            // 3. Try Supplier Custom Price (Milling or Full) from DB
                            // Check for exact match or fuzzy match in supplier prices
                            // Note: `customPrices` is Record<string, number>

                            // Try to match service name with existing services to get Canonical Name if possible
                            const matchedService = services.find(s => s.name === serviceName || s.name.toLowerCase() === serviceName.toLowerCase());
                            const canonicalServiceName = matchedService ? matchedService.name : serviceName;

                            let supplierUnitCost = 0;

                            if (foundSupplier.customPrices && foundSupplier.customPrices[canonicalServiceName]) {
                                supplierUnitCost = foundSupplier.customPrices[canonicalServiceName];
                            }
                            else if (foundSupplier.millingPrices && foundSupplier.millingPrices[canonicalServiceName]) {
                                supplierUnitCost = foundSupplier.millingPrices[canonicalServiceName];
                            }
                            // 4. Fallback to General Service Cost (System Defaults)
                            else if (matchedService) {
                                // User requested to use Cost Price specifically, not Milling Price
                                supplierUnitCost = matchedService.costPrice || 0;
                            }

                            if (supplierUnitCost > 0) {
                                cost = supplierUnitCost * toothCount;
                            }
                        }
                    }

                    const discount = parseNumber(row['الخصم'] || row['discount'] || row['Discount'] || 0);
                    const shade = cleanString(row['اللون'] || row['shade'] || row['Shade'] || 'A1');
                    const status = cleanString(row['الحالة'] || row['status'] || row['Status'] || 'Delivered');
                    const deliveryDate = parseDate(row['تاريخ التسليم'] || row['delivery_date'] || row['DeliveryDate'] || row['التاريخ']);
                    const priority = cleanString(row['الأولوية'] || row['priority'] || row['Priority'] || 'Normal') as 'Normal' | 'Urgent';

                    return {
                        id: generateUUID(),
                        caseId,
                        doctorId,
                        patientName: patientName || 'غير محدد',
                        items: items,
                        discount: discount || 0,
                        totalPrice: totalPrice, // Using the logic above
                        shade: shade || 'A1',
                        status: status as any || 'Delivered', // Default to Delivered
                        deliveryDate,
                        cost: cost || 0,
                        priority: priority || 'Normal',
                        supplierId: supplierId, // Linked Supplier
                        isRegistered: true, // Auto-register imported cases as requested
                        feedback: {
                            rating: 5,
                            issues: [],
                            rootCause: 'Lab',
                            notes: 'Imported / استيراد تلقائي',
                            createdAt: new Date().toISOString()
                        },
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
