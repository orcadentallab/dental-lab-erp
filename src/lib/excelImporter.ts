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
        if (date && date.y && date.m && date.d) {
            return `${date.y}-${String(date.m).padStart(2, '0')}-${String(date.d).padStart(2, '0')}`;
        }
    }

    // If it's a string, try to parse it
    if (typeof value === 'string') {
        const trimmed = value.trim();

        // Try ISO format (2024-01-15)
        if (trimmed.match(/^\d{4}-\d{2}-\d{2}/)) {
            return trimmed.split('T')[0];
        }

        // Try dd/mm/yyyy format (common in Arabic Excel)
        const ddmmyyyy = trimmed.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
        if (ddmmyyyy) {
            const day = ddmmyyyy[1].padStart(2, '0');
            const month = ddmmyyyy[2].padStart(2, '0');
            const year = ddmmyyyy[3];
            return `${year}-${month}-${day}`;
        }

        // Try mm/dd/yyyy format - if first number > 12, treat as dd/mm/yyyy
        const mmddyyyy = trimmed.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
        if (mmddyyyy && parseInt(mmddyyyy[1]) > 12) {
            const day = mmddyyyy[1].padStart(2, '0');
            const month = mmddyyyy[2].padStart(2, '0');
            const year = mmddyyyy[3];
            return `${year}-${month}-${day}`;
        }

        // Try yyyy/mm/dd format
        const yyyymmdd = trimmed.match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/);
        if (yyyymmdd) {
            const year = yyyymmdd[1];
            const month = yyyymmdd[2].padStart(2, '0');
            const day = yyyymmdd[3].padStart(2, '0');
            return `${year}-${month}-${day}`;
        }

        // Try other formats using Date.parse
        const date = new Date(trimmed);
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
                    } catch (err: unknown) {
                        errors.push(`الصف ${index + 2}: ${err instanceof Error ? err.message : String(err)}`);
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
                    } catch (err: unknown) {
                        errors.push(`الصف ${index + 2}: ${err instanceof Error ? err.message : String(err)}`);
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

                        // Supplier Logic
                        const supplierName = cleanString(getVal(['المعمل المنفذ', 'المعمل', 'Executing Lab', 'Lab', 'Supplier', 'Laboratory', 'المعمل الخارجي']));
                        const supplierCode = cleanString(getVal(['كود المعمل', 'كود المورد', 'Supplier Code', 'Lab Code', 'code']));
                        let supplierId: string | undefined = undefined;
                        let foundSupplier: Supplier | undefined = undefined;

                        if (supplierCode) {
                            foundSupplier = suppliers.find(s => s.supplierCode && s.supplierCode.toUpperCase() === supplierCode.toUpperCase());
                            if (!foundSupplier && !supplierName) {
                                throw new Error(`لم يتم العثور على المعمل بالكود (${supplierCode})`);
                            }
                        }

                        if (!foundSupplier && supplierName) {
                            const normalizedSupplierSearch = normalizeArabic(supplierName);
                            foundSupplier = suppliers.find(s => normalizeArabic(s.name) === normalizedSupplierSearch || normalizeArabic(s.name).includes(normalizedSupplierSearch));
                            if (foundSupplier) {
                                supplierId = foundSupplier.id;
                            } else {
                                throw new Error(`لم يتم العثور على المعمل (${supplierName})`);
                            }
                        } else if (foundSupplier) {
                            supplierId = foundSupplier.id;
                        }


                        // Service & Item Logic (Multi-Service Support)
                        let items: OrderItem[] = [];
                        let calculatedTotal = 0;
                        let calculatedCost = 0;

                        // Check up to 5 services per row
                        for (let i = 1; i <= 5; i++) {
                            // Column names for Service Name
                            const serviceKeys = [
                                `الخدمة ${i}`, `Service ${i}`, `Service${i}`,
                                `اسم الخدمة ${i}`, `ServiceName${i}`,
                                `الخدمه ${i}`, `الخدمة${i}`
                            ];
                            // Also check without number for the first one for backward compatibility
                            if (i === 1) {
                                serviceKeys.push('اسم الصنف', 'الخدمات', 'الخدمة', 'اسم الخدمة', 'Service', 'service');
                            }

                            const serviceName = cleanString(getVal(serviceKeys));
                            if (!serviceName) continue; // No service in this slot

                            // Column names for Count
                            const countKeys = [
                                `العدد ${i}`, `كمية ${i}`, `الكمية ${i}`, `عدد الاسنان ${i}`,
                                `عدد الاسنان الخدمة ${i}`, `عدد الأسنان الخدمة ${i}`,
                                `Count ${i}`, `Count${i}`, `Quantity ${i}`, `Quantity${i}`,
                                `عدد ${i}`, `Tooth Count ${i}`
                            ];
                            if (i === 1) {
                                countKeys.push('كمية', 'الكمية', 'عدد الاسنان', 'Count', 'count', 'Quantity');
                            }

                            const countVal = parseNumber(getVal(countKeys));
                            const toothCount = countVal > 0 ? countVal : 1;

                            // Column names for Price (Per Unit) - Optional override
                            // Often prices are not per-service column in these sheets, but we check if they exist
                            // If not, we fall back to system price
                            const priceKeys = [`سعر ${i}`, `Price ${i}`, `Price${i}`, `Unit Price ${i}`];
                            if (i === 1) priceKeys.push('سعر للواحدة', 'سعر الوحدة', 'السعر', 'Unit Price', 'price');

                            const rawPrice = getVal(priceKeys);
                            let unitPrice = 0;

                            // Price Lookup
                            if (rawPrice !== undefined && rawPrice !== null && String(rawPrice).trim() !== '') {
                                unitPrice = parseNumber(rawPrice);
                            } else {
                                // Look up system price
                                const normalizedServiceSearch = normalizeArabic(serviceName);
                                const matchedService = services.find(s => normalizeArabic(s.name) === normalizedServiceSearch);
                                if (matchedService) {
                                    unitPrice = matchedService.sellingPrice;
                                }
                            }

                            // Generate Teeth Numbers
                            const teethNumbers: string[] = [];
                            for (let t = 1; t <= toothCount; t++) {
                                teethNumbers.push(String(t));
                            }

                            // Item Cost Calculation
                            let itemCost = 0;
                            // Check if specific cost column exists for this item (rare)
                            // Usually cost is calculated or total cost is given.
                            // We attempt to calculate unit cost from supplier if known
                            if (foundSupplier) {
                                const normalizedServiceSearch = normalizeArabic(serviceName);
                                const matchedService = services.find(s => normalizeArabic(s.name) === normalizedServiceSearch);
                                const canonicalServiceName = matchedService ? matchedService.name : serviceName;

                                let supplierUnitCost = 0;
                                if (foundSupplier.customPrices?.[canonicalServiceName] !== undefined) {
                                    supplierUnitCost = foundSupplier.customPrices[canonicalServiceName];
                                } else if (foundSupplier.millingPrices?.[canonicalServiceName] !== undefined) {
                                    supplierUnitCost = foundSupplier.millingPrices[canonicalServiceName];
                                } else if (matchedService) {
                                    supplierUnitCost = matchedService.costPrice || 0;
                                }
                                itemCost = supplierUnitCost * toothCount;
                            } else {
                                // If no supplier, check system cost
                                const normalizedServiceSearch = normalizeArabic(serviceName);
                                const matchedService = services.find(s => normalizeArabic(s.name) === normalizedServiceSearch);
                                if (matchedService) {
                                    itemCost = (matchedService.costPrice || 0) * toothCount;
                                }
                            }

                            calculatedCost += itemCost;
                            calculatedTotal += (unitPrice * toothCount);

                            items.push({
                                serviceType: serviceName,
                                teethNumbers: teethNumbers,
                                price: unitPrice
                            });
                        }

                        // Fallback to JSON items if no columns found (backward compatibility)
                        if (items.length === 0) {
                            try {
                                const itemsStr = getVal(['العناصر', 'items', 'Items']) || '[]';
                                if (typeof itemsStr === 'string') {
                                    const parsed = JSON.parse(itemsStr) as OrderItem[];
                                    if (Array.isArray(parsed)) items = parsed;
                                }
                            } catch { /* ignore */ }

                            // Re-calculate total from these items if we found them
                            if (items.length > 0) {
                                calculatedTotal = items.reduce((sum, item) => sum + (item.price * item.teethNumbers.length), 0);
                            }
                        }


                        const netValue = parseNumber(getVal(['صافى قيمة', 'صافي القيمة', 'Total Value', 'Net Value']));
                        const totalPrice = netValue > 0 ? netValue : calculatedTotal;

                        // Total Cost Logic
                        // 1. Explicit Total Cost Column
                        // 2. Sum of calculated item costs
                        let cost = parseNumber(getVal(['التكلفة', 'cost', 'Cost', 'اجمالي التكلفة', 'Total Cost']));

                        if (cost === 0 && calculatedCost > 0) {
                            cost = calculatedCost;
                        }

                        // Just in case calculation failed and we have explicit unit cost column (old format)
                        if (cost === 0 && items.length > 0) {
                            const excelUnitCost = parseNumber(getVal(['سعر الشراء', 'Buying Price', 'Unit Cost']));
                            if (excelUnitCost > 0) {
                                const totalTeeth = items.reduce((sum, i) => sum + i.teethNumbers.length, 0);
                                cost = excelUnitCost * totalTeeth;
                            }
                        }


                        const discount = parseNumber(getVal(['خصم', 'الخصم', 'discount', 'Discount']));
                        const shade = cleanString(getVal(['اللون', 'shade', 'Shade'])) || 'A1';

                        // Updated Status Parsing
                        const statusStr = cleanString(getVal(['حالة الاوردر', 'Order Status', 'Status', 'الحالة', 'status'])).trim();

                        // Normalize status (case insensitive matching)
                        let status: Order['status'] = 'Delivered';
                        const validStatuses = ['New Case', 'Under Design', 'Design Completed', 'Printing', 'Milling', 'Finishing', 'Ready', 'Delivered', 'Completed', 'Cancelled', 'Try in', 'try in', 'Try In', 'under design'];

                        // Find match ignoring case
                        const matchedStatus = validStatuses.find(s => s.toLowerCase() === statusStr.toLowerCase());

                        if (matchedStatus) {
                            // Convert to canonical case
                            if (matchedStatus.toLowerCase() === 'try in') status = 'Try In';
                            else if (matchedStatus.toLowerCase() === 'under design') status = 'Under Design';
                            else status = matchedStatus as Order['status'];
                        } else if (statusStr) {
                            status = 'Delivered';
                        }

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
                    } catch (err: unknown) {
                        errors.push(`الصف ${index + 2}: ${err instanceof Error ? err.message : String(err)}`);
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
                        const date = parseDate(getVal(['التاريخ', 'تاريخ المستند', 'date', 'Date', 'تاريخ']));
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
                    } catch (err: unknown) {
                        errors.push(`الصف ${index + 2}: ${err instanceof Error ? err.message : String(err)}`);
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

// Helper for Lab Correction Tool
export function parseLabAssignments(file: File, suppliers: Supplier[]): Promise<Array<{ patient: string; service: string; supplierId: string }>> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const data = new Uint8Array(e.target?.result as ArrayBuffer);
                const workbook = XLSX.read(data, { type: 'array' });
                const worksheet = workbook.Sheets[workbook.SheetNames[0]];
                const jsonData = XLSX.utils.sheet_to_json(worksheet) as ExcelRow[];

                const assignments: Array<{ patient: string; service: string; supplierId: string }> = [];

                jsonData.forEach((row) => {
                    const getVal = (keys: string[]) => {
                        for (const k of keys) {
                            if (row[k] !== undefined && row[k] !== null) return row[k];
                        }
                        return undefined;
                    };

                    const patient = cleanString(getVal(['اسم المريض', 'المريض', 'patient_name', 'PatientName']));
                    const service = cleanString(getVal(['اسم الصنف', 'الخدمات', 'الخدمة', 'اسم الخدمة', 'Service', 'service']));

                    const supplierName = cleanString(getVal(['المعمل المنفذ', 'المعمل', 'Executing Lab', 'Lab', 'Supplier', 'Laboratory', 'المعمل الخارجي']));
                    const supplierCode = cleanString(getVal(['كود المعمل', 'كود المورد', 'Supplier Code', 'Lab Code', 'code']));

                    if (patient && service && (supplierName || supplierCode)) {
                        let foundSupplier: Supplier | undefined;

                        if (supplierCode) {
                            foundSupplier = suppliers.find(s => s.supplierCode && s.supplierCode.toUpperCase() === supplierCode.toUpperCase());
                        }

                        if (!foundSupplier && supplierName) {
                            const normalizedSupplierSearch = normalizeArabic(supplierName);
                            foundSupplier = suppliers.find(s => normalizeArabic(s.name) === normalizedSupplierSearch || normalizeArabic(s.name).includes(normalizedSupplierSearch));
                        }

                        if (foundSupplier) {
                            assignments.push({
                                patient: normalizeArabic(patient),
                                service: normalizeArabic(service),
                                supplierId: foundSupplier.id
                            });
                        }
                    }
                });

                resolve(assignments);
            } catch (err: unknown) {
                reject(new Error(`Error parsing file: ${err instanceof Error ? err.message : String(err)}`));
            }
        };
        reader.readAsArrayBuffer(file);
    });
}
