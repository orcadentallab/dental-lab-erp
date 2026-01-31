/* eslint-disable @typescript-eslint/consistent-type-assertions */
import * as XLSX from 'xlsx';
import type { Doctor, Service, Order, Transaction, Supplier, OrderItem } from '../services/db';
import { generateUUID } from './utils';

// Helper Type for Excel Rows
type ExcelRow = Record<string, unknown>;

// Helper to parse Excel date to ISO string
function parseDate(value: unknown): string {
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
function cleanString(value: unknown): string {
    if (value === null || value === undefined) return '';
    return String(value).trim();
}

// Helper to parse number
function parseNumber(value: unknown): number {
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

                const sheetName = workbook.SheetNames[0];
                const worksheet = workbook.Sheets[sheetName];
                const jsonData = XLSX.utils.sheet_to_json(worksheet) as ExcelRow[];

                const doctors: Doctor[] = [];
                const errors: string[] = [];

                jsonData.forEach((row, index) => {
                    try {
                        const getCol = (keys: string[]) => {
                            for (const k of keys) {
                                if (row[k] !== undefined && row[k] !== null) return cleanString(String(row[k]));
                            }
                            return '';
                        };

                        const name = getCol(['اسم الطبيب', 'الاسم', 'name', 'Name']);
                        const phone = getCol(['الهاتف', 'تليفون', 'phone', 'Phone', 'موبايل']);
                        const phone2 = getCol(['هاتف 2', 'الهاتف 2', 'phone2', 'Phone2', 'تليفون 2']);
                        const address = getCol(['العنوان', 'address', 'Address']);
                        const doctorCode = getCol(['كود الطبيب', 'الكود', 'doctor_code', 'DoctorCode', 'code']) || `DR${index + 1}`;
                        const representativeName = getCol(['اسم المندوب', 'المندوب', 'representative_name', 'RepresentativeName']);
                        const representativeId = row['representative_id'] || row['RepresentativeId'] || null;

                        if (!name) {
                            throw new Error(`اسم الطبيب مفقود`);
                        }

                        doctors.push({
                            id: generateUUID(),
                            name,
                            phone: phone || 'غير محدد',
                            phone2: phone2 || undefined,
                            address: address || 'غير محدد',
                            doctorCode: doctorCode.toUpperCase(),
                            representativeName: representativeName || 'غير محدد',
                            representativeId: (representativeId as string) || undefined
                        });
                    } catch (err: any) {
                        errors.push(`الصف ${index + 2}: ${err.message}`);
                    }
                });

                if (errors.length > 0) {
                    reject(new Error(`فشل استيراد بعض الصفوف:\n${errors.join('\n')}`));
                    return;
                }

                resolve(doctors);
            } catch (error: unknown) {
                const msg = error instanceof Error ? error.message : String(error);
                reject(new Error(`خطأ في قراءة ملف Excel: ${msg}`));
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
                const jsonData = XLSX.utils.sheet_to_json(worksheet) as ExcelRow[];

                const services: Service[] = [];
                const errors: string[] = [];

                jsonData.forEach((row, index) => {
                    try {
                        const getVal = (keys: string[]) => {
                            for (const k of keys) {
                                if (row[k] !== undefined && row[k] !== null) return row[k];
                            }
                            return undefined;
                        };

                        const name = cleanString(getVal(['اسم الخدمة', 'الاسم', 'name', 'Name', 'الخدمة']));
                        const sellingPrice = parseNumber(getVal(['سعر البيع', 'سعر المبيعة', 'selling_price', 'SellingPrice', 'price']));
                        const costPrice = parseNumber(getVal(['سعر التكلفة', 'التكلفة', 'cost_price', 'CostPrice', 'cost']));
                        const millingPrice = parseNumber(getVal(['سعر الخراطة', 'milling_price', 'MillingPrice', 'خراطة']));

                        if (!name) {
                            throw new Error(`اسم الخدمة مطلوب`);
                        }

                        services.push({
                            id: generateUUID(),
                            name,
                            sellingPrice: sellingPrice || 0,
                            costPrice: costPrice || 0,
                            millingPrice: millingPrice || 0
                        });
                    } catch (err: any) {
                        errors.push(`الصف ${index + 2}: ${err.message}`);
                    }
                });

                if (errors.length > 0) {
                    reject(new Error(`فشل استيراد بعض الصفوف:\n${errors.join('\n')}`));
                    return;
                }

                resolve(services);
            } catch (error: unknown) {
                const msg = error instanceof Error ? error.message : String(error);
                reject(new Error(`خطأ في قراءة ملف Excel: ${msg}`));
            }
        };
        reader.onerror = () => reject(new Error('فشل قراءة الملف'));
        reader.readAsArrayBuffer(file);
    });
}

// Helper to normalize Arabic text for smarter matching
function normalizeArabic(text: string): string {
    if (!text) return '';
    return text
        .trim()
        .toLowerCase()
        .replace(/[أإآ]/g, 'ا')
        .replace(/ى/g, 'ي')
        .replace(/ة/g, 'ه')
        .replace(/[\u064B-\u065F]/g, ''); // Remove Harakat
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
                const jsonData = XLSX.utils.sheet_to_json(worksheet) as ExcelRow[];

                const orders: Order[] = [];
                const errors: string[] = [];

                jsonData.forEach((row, index) => {
                    try {
                        const getVal = (keys: string[]) => {
                            for (const k of keys) {
                                if (row[k] !== undefined && row[k] !== null) return row[k];
                            }
                            return undefined;
                        };

                        // Find doctor
                        const doctorCode = cleanString(getVal(['كود الطبيب', 'doctor_code', 'DoctorCode', 'الكود']));
                        const doctorName = cleanString(getVal(['اسم الطبيب', 'الطبيب', 'doctor_name', 'DoctorName']));
                        let doctorId = '';
                        let foundDoctor: Doctor | undefined;

                        if (doctorCode) {
                            foundDoctor = doctors.find(d => d.doctorCode?.toUpperCase() === doctorCode.toUpperCase());
                        }
                        if (!foundDoctor && doctorName) {
                            const normalizedSearch = normalizeArabic(doctorName);
                            foundDoctor = doctors.find(d => normalizeArabic(d.name) === normalizedSearch || normalizeArabic(d.name).includes(normalizedSearch));
                        }
                        if (foundDoctor) {
                            doctorId = foundDoctor.id;
                        }

                        if (!doctorId) {
                            const identifier = doctorCode || doctorName || 'غير معروف';
                            throw new Error(`لم يتم العثور على الطبيب (${identifier})`);
                        }

                        const patientName = cleanString(getVal(['اسم المريض', 'المريض', 'patient_name', 'PatientName']));
                        const caseId = cleanString(getVal(['رقم الحالة', 'كود الحالة', 'case_id', 'CaseId'])) || `CASE-${Date.now()}-${index}`;

                        let items: OrderItem[] = [];
                        const serviceName = cleanString(getVal(['اسم الصنف', 'الخدمات', 'الخدمة', 'اسم الخدمة', 'Service', 'service']));
                        const countColumn = parseNumber(getVal(['كمية', 'الكمية', 'عدد الاسنان', 'Count', 'count', 'Quantity']));
                        const toothCount = countColumn > 0 ? countColumn : 1;

                        const supplierName = cleanString(getVal(['المعمل المنفذ', 'المعمل', 'Executing Lab', 'Lab', 'Supplier']));
                        let supplierId: string | undefined = undefined;
                        let foundSupplier: Supplier | undefined = undefined;

                        if (supplierName) {
                            const normalizedSupplierSearch = normalizeArabic(supplierName);
                            foundSupplier = suppliers.find(s => normalizeArabic(s.name) === normalizedSupplierSearch || normalizeArabic(s.name).includes(normalizedSupplierSearch));
                            if (foundSupplier) {
                                supplierId = foundSupplier.id;
                            }
                        }

                        if (serviceName) {
                            const unitPrice = parseNumber(getVal(['سعر للواحدة', 'سعر الوحدة', 'السعر', 'Unit Price', 'price']));
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
                                const itemsStr = getVal(['العناصر', 'items', 'Items']) || '[]';
                                if (typeof itemsStr === 'string') {
                                    items = JSON.parse(itemsStr) as OrderItem[];
                                } else if (Array.isArray(itemsStr)) {
                                    items = itemsStr as unknown as OrderItem[];
                                }
                            } catch { /* ignore */ }
                        }

                        const netValue = parseNumber(getVal(['صافى قيمة', 'صافي القيمة', 'Total Value', 'Net Value']));
                        const calculatedTotal = items.reduce((sum, item) => sum + (item.price * item.teethNumbers.length), 0);
                        const totalPrice = netValue > 0 ? netValue : calculatedTotal;

                        let cost = parseNumber(getVal(['التكلفة', 'cost', 'Cost', 'اجمالي التكلفة', 'Total Cost']));

                        if (cost === 0 && items.length > 0) {
                            const excelUnitCost = parseNumber(getVal(['سعر الشراء', 'Buying Price', 'Unit Cost']));
                            if (excelUnitCost > 0) {
                                cost = excelUnitCost * toothCount;
                            } else if (foundSupplier && serviceName) {
                                const normalizedServiceSearch = normalizeArabic(serviceName);
                                const matchedService = services.find(s => normalizeArabic(s.name) === normalizedServiceSearch);
                                const canonicalServiceName = matchedService ? matchedService.name : serviceName;
                                let supplierUnitCost = 0;
                                if (foundSupplier.customPrices && foundSupplier.customPrices[canonicalServiceName]) {
                                    supplierUnitCost = foundSupplier.customPrices[canonicalServiceName];
                                } else if (foundSupplier.millingPrices && foundSupplier.millingPrices[canonicalServiceName]) {
                                    supplierUnitCost = foundSupplier.millingPrices[canonicalServiceName];
                                } else if (matchedService) {
                                    supplierUnitCost = matchedService.costPrice || 0;
                                }
                                if (supplierUnitCost > 0) cost = supplierUnitCost * toothCount;
                            }
                        }

                        const discount = parseNumber(getVal(['خصم', 'الخصم', 'discount', 'Discount']));
                        const shade = cleanString(getVal(['اللون', 'shade', 'Shade'])) || 'A1';
                        const statusStr = cleanString(getVal(['الحالة', 'status', 'Status'])) || 'Delivered';
                        const status = (['New Case', 'Under Design', 'Design Completed', 'Printing', 'Milling', 'Finishing', 'Ready', 'Delivered', 'Completed', 'Cancelled'].includes(statusStr) ? statusStr : 'Delivered') as Order['status'];
                        const deliveryDate = parseDate(getVal(['تاريخ التسليم', 'delivery_date', 'DeliveryDate', 'التاريخ']));
                        const priorityStr = cleanString(getVal(['الأولوية', 'priority', 'Priority']));
                        const priority = (priorityStr === 'Urgent' ? 'Urgent' : 'Normal') as 'Normal' | 'Urgent';

                        orders.push({
                            id: generateUUID(),
                            caseId,
                            doctorId,
                            patientName: patientName || 'غير محدد',
                            items: items,
                            discount: discount || 0,
                            totalPrice: totalPrice,
                            shade: shade,
                            status: status,
                            deliveryDate,
                            cost: cost || 0,
                            priority: priority,
                            supplierId: supplierId,
                            isRegistered: true,
                            feedback: {
                                rating: 5,
                                issues: [],
                                rootCause: 'Lab',
                                notes: 'Imported / استيراد تلقائي',
                                createdAt: new Date().toISOString()
                            },
                            createdAt: new Date().toISOString()
                        } as Order);
                    } catch (err: any) {
                        errors.push(`الصف ${index + 2}: ${err.message}`);
                    }
                });

                if (errors.length > 0) {
                    reject(new Error(`فشل استيراد بعض الصفوف:\n${errors.join('\n')}`));
                    return;
                }

                resolve(orders);
            } catch (error: unknown) {
                const msg = error instanceof Error ? error.message : String(error);
                reject(new Error(`خطأ في قراءة ملف Excel: ${msg}`));
            }
        };
        reader.onerror = () => reject(new Error('فشل قراءة الملف'));
        reader.readAsArrayBuffer(file);
    });
}

// Import Transactions from Excel
export function importTransactionsFromExcel(
    file: File,
    doctors: Doctor[] = [],
    suppliers: Supplier[] = [],
    mode: 'auto' | 'doctor' | 'supplier' | 'expense' = 'auto'
): Promise<Transaction[]> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const data = new Uint8Array(e.target?.result as ArrayBuffer);
                const workbook = XLSX.read(data, { type: 'array' });

                const sheetName = workbook.SheetNames[0];
                const worksheet = workbook.Sheets[sheetName];
                const jsonData = XLSX.utils.sheet_to_json(worksheet) as ExcelRow[];

                const transactions: Transaction[] = [];
                const errors: string[] = [];

                jsonData.forEach((row, index) => {
                    try {
                        const getVal = (keys: string[]) => {
                            for (const k of keys) {
                                if (row[k] !== undefined && row[k] !== null) return row[k];
                            }
                            return undefined;
                        };

                        const amount = parseNumber(getVal(['المبلغ', 'amount', 'Amount', 'القيمة', 'Value', 'السعر', 'Debit', 'مدين']));
                        const date = parseDate(getVal(['التاريخ', 'date', 'Date']));
                        const description = cleanString(getVal(['الوصف', 'description', 'Description', 'البيان', 'ملاحظات', 'Notes']));
                        let category = cleanString(getVal(['الفئة', 'category', 'Category', 'النوع', 'Type', 'نوع', 'القسم', 'Section'])) || 'عام';

                        if (!amount || amount <= 0) {
                            throw new Error(`المبلغ مطلوب`);
                        }

                        let entityId: string | undefined;
                        let entityType: 'doctor' | 'supplier' | 'designer' | 'general' | undefined;
                        let type: 'income' | 'expense' = 'expense';

                        if (mode === 'doctor') {
                            const doctorName = cleanString(getVal(['اسم الطبيب', 'Doctor Name', 'Doctor', 'العميل', 'Client', 'Name']));
                            const doctorCode = cleanString(getVal(['كود الطبيب', 'Doctor Code', 'Code']));

                            if (!doctorName && !doctorCode) {
                                throw new Error(`اسم الطبيب أو الكود مطلوب`);
                            }

                            const normalizedSearch = normalizeArabic(doctorName);
                            const doctor = doctors.find(d =>
                                (doctorCode && d.doctorCode && d.doctorCode.toLowerCase() === doctorCode.toLowerCase()) ||
                                (doctorName && (normalizeArabic(d.name) === normalizedSearch || normalizeArabic(d.name).includes(normalizedSearch)))
                            );

                            if (!doctor) {
                                throw new Error(`لم يتم العثور على الطبيب (${doctorName || doctorCode})`);
                            }

                            entityType = 'doctor';
                            entityId = doctor.id;
                            type = 'income';
                            if (category === 'عام') category = 'تحصيلات';

                        } else if (mode === 'supplier') {
                            const supplierName = cleanString(getVal(['اسم المورد', 'Supplier Name', 'Supplier', 'Name']));
                            if (!supplierName) {
                                throw new Error(`اسم المورد مطلوب`);
                            }
                            const normalizedSupplierSearch = normalizeArabic(supplierName);
                            const supplier = suppliers.find(s => normalizeArabic(s.name) === normalizedSupplierSearch || normalizeArabic(s.name).includes(normalizedSupplierSearch));
                            if (!supplier) {
                                throw new Error(`لم يتم العثور على المورد (${supplierName})`);
                            }
                            entityType = 'supplier';
                            entityId = supplier.id;
                            type = 'expense';
                            if (category === 'عام') category = 'خامات';

                        } else if (mode === 'expense') {
                            type = 'expense';
                            entityType = 'general';
                            // If category is still 'عام' but there's a type column, prefer that
                            const detailType = cleanString(getVal(['نوع المصروف', 'Expense Type', 'نوع المعاملة']));
                            if (detailType) category = detailType;
                        } else {
                            const typeStr = cleanString(getVal(['النوع', 'type', 'Type']) || '').toLowerCase();
                            const doctorName = cleanString(getVal(['اسم الطبيب', 'Doctor Name', 'Doctor', 'Name']));
                            const doctorCode = cleanString(getVal(['كود الطبيب', 'Code']));
                            const supplierName = cleanString(getVal(['اسم المورد', 'Supplier']));

                            if (doctorName || doctorCode) {
                                const normalizedSearch = normalizeArabic(doctorName);
                                const doctor = doctors.find(d =>
                                    (doctorCode && d.doctorCode && d.doctorCode.toLowerCase() === doctorCode.toLowerCase()) ||
                                    (doctorName && (normalizeArabic(d.name) === normalizedSearch || normalizeArabic(d.name).includes(normalizedSearch)))
                                );
                                if (doctor) {
                                    entityType = 'doctor';
                                    entityId = doctor.id;
                                    type = 'income';
                                }
                            }
                            if (!entityId && supplierName) {
                                const normalizedSupplierSearch = normalizeArabic(supplierName);
                                const supplier = suppliers.find(s => normalizeArabic(s.name) === normalizedSupplierSearch || normalizeArabic(s.name).includes(normalizedSupplierSearch));
                                if (supplier) {
                                    entityType = 'supplier';
                                    entityId = supplier.id;
                                    type = 'expense';
                                }
                            }

                            // If still no entityType, default to 'general'
                            if (!entityType) {
                                entityType = 'general';
                            }
                            if (typeStr) {
                                if (['income', 'دخل', 'ايراد', 'إيراد', 'collection', 'payment from', 'تحصيل', 'قبض'].some(s => typeStr.includes(s))) {
                                    type = 'income';
                                } else if (['expense', 'مصروف', 'دفع', 'payment to', 'sadas', 'سداد'].some(s => typeStr.includes(s))) {
                                    type = 'expense';
                                }
                            }
                        }

                        transactions.push({
                            id: generateUUID(),
                            type,
                            amount,
                            category,
                            date,
                            description: description || (entityType === 'doctor' ? 'دفعة من حساب' : (entityType === 'supplier' ? 'سداد لمورد' : 'مصروف عام')),
                            entityId,
                            entityType,
                            isRegistered: false,
                            isApproved: true
                        } as Transaction);
                    } catch (err: any) {
                        errors.push(`الصف ${index + 2}: ${err.message}`);
                    }
                });

                if (errors.length > 0) {
                    reject(new Error(`فشل استيراد بعض الصفوف:\n${errors.join('\n')}`));
                    return;
                }

                resolve(transactions);
            } catch (error: unknown) {
                const msg = error instanceof Error ? error.message : String(error);
                reject(new Error(`خطأ في قراءة ملف Excel: ${msg}`));
            }
        };
        reader.onerror = () => reject(new Error('فشل قراءة الملف'));
        reader.readAsArrayBuffer(file);
    });
}
