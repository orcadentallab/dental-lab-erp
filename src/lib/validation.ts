/* eslint-disable @typescript-eslint/no-explicit-any */
import { z } from 'zod';

// User Validation Schemas
export const UserSchema = z.object({
    id: z.string().uuid().optional(),
    username: z.string().min(3, 'اسم المستخدم يجب أن يكون من 3 أحرف على الأقل').max(50, 'اسم المستخدم طويل جداً').regex(/^[a-zA-Z0-9_]+$/, 'اسم المستخدم يجب أن يحتوي على حروف وأرقام فقط'),
    email: z.string().email('البريد الإلكتروني غير صحيح').min(5, 'البريد الإلكتروني قصير جداً').max(255, 'البريد الإلكتروني طويل جداً'),
    password: z.string().min(6, 'كلمة المرور يجب أن تكون 6 أحرف على الأقل')
        .optional(), // Optional for updates
    role: z.enum(['admin', 'lab', 'representative', 'accountant', 'designer', 'doctor']),
    name: z.string().min(2, 'الاسم يجب أن يكون من حرفين على الأقل').max(200, 'الاسم طويل جداً'),
    entityId: z.string().uuid().optional().nullable(),
    baseSalary: z.number().min(0, 'الراتب الأساسي لا يمكن أن يكون أقل من صفر').optional().nullable(),
    unitRate: z.number().min(0, 'سعر القطعة لا يمكن أن يكون أقل من صفر').optional().nullable(),
    designerServicePrices: z.record(z.string(), z.number().min(0)).optional().nullable(),
    auth_id: z.string().uuid().optional(),
    isActive: z.boolean().optional(),
    deactivatedAt: z.string().optional().nullable(),
    employeeType: z.enum(['sales_rep', 'accountant', 'admin', 'other']).optional().nullable()
});

export const UserCreateSchema = UserSchema.extend({
    password: z.string().min(6, 'كلمة المرور يجب أن تكون 6 أحرف على الأقل')
});

export const UserUpdateSchema = UserSchema.partial().extend({
    id: z.string().uuid()
});

// Doctor Validation Schemas
export const DoctorSchema = z.object({
    id: z.string().uuid().optional(),
    name: z.string().min(2, 'الاسم يجب أن يكون من حرفين على الأقل').max(200),
    phone: z.string().min(3).max(20).regex(/^[0-9+\-\s()]+$/, 'رقم الهاتف غير صحيح'),
    phone2: z.union([z.string().min(8).max(20).regex(/^[0-9+\-\s()]+$/), z.literal('')]).optional().nullable(),
    address: z.string().min(5, 'العنوان يجب أن يكون من 5 أحرف على الأقل').max(500),
    doctorCode: z.string().min(1, 'كود الطبيب مطلوب').max(20),
    representativeName: z.string().max(200).optional().nullable().or(z.literal('')),
    representativeId: z.union([z.string().uuid(), z.literal('')]).optional().nullable(),
    customPrices: z.record(z.string(), z.number().min(0)).optional().nullable(),
    isCenter: z.boolean().optional().nullable(),
    parentId: z.union([z.string().uuid(), z.literal('')]).optional().nullable(),
    hasBranches: z.boolean().optional().nullable(),
    branches: z.array(z.object({
        id: z.string(),
        name: z.string().min(1, 'اسم الفرع مطلوب'),
        address: z.string().optional().or(z.literal('')),
        phone: z.string().optional().or(z.literal(''))
    })).optional().nullable()
});

export const DoctorCreateSchema = DoctorSchema;
export const DoctorUpdateSchema = DoctorSchema.partial().extend({
    id: z.string().uuid()
});

// Order Validation Schemas
export const OrderItemSchema = z.object({
    serviceType: z.string().min(1, 'نوع الخدمة مطلوب').max(200),
    teethNumbers: z.array(z.string()).min(1, 'يجب تحديد أرقام الأسنان'),
    price: z.number().min(0, 'السعر لا يمكن أن يكون أقل من صفر'),
    shade: z.string().optional()
});

export const OrderSchema = z.object({
    id: z.string().uuid().optional(),
    caseId: z.string().min(1, 'رقم الحالة مطلوب').max(50),
    doctorId: z.string().uuid('يرجى اختيار طبيب/مركز طبي صالح'),
    branchName: z.string().max(200).optional().nullable(),
    patientName: z.string().min(2, 'اسم المريض يجب أن يكون من حرفين على الأقل').max(200, 'اسم المريض طويل جداً'),
    items: z.array(OrderItemSchema).min(1, 'يجب إضافة عنصر واحد على الأقل'),
    discount: z.number().min(0, 'الخصم لا يمكن أن يكون أقل من صفر'),
    totalPrice: z.number().min(0, 'السعر الإجمالي لا يمكن أن يكون أقل من صفر'),
    shade: z.string().max(50).optional().nullable(),
    status: z.enum(['Pending', 'In Progress', 'Completed', 'Delivered', 'New Case', 'Under Design', 'Waiting Dr Approval', 'Under Production', 'Try In', 'Try In Approved', 'Ready', 'Returned for Adjustments', 'Rejected', 'Cancelled', 'Pending Review', 'Doctor Rejected', 'Lab Rejected']),
    isUrgent: z.boolean().optional(),
    deliveryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'تاريخ التسليم غير صحيح (الصيغة المطلوبة: YYYY-MM-DD)'),
    cost: z.number().min(0, 'التكلفة لا يمكن أن تكون أقل من صفر'),
    manualCost: z.number().min(0, 'التكلفة اليدوية لا يمكن أن تكون أقل من صفر').optional().nullable(),
    stlUrl: z.string().url('رابط ملف STL غير صالح، يجب أن يكون رابطاً صحيحاً يبدأ بـ http أو https').optional().nullable(),
    supplierId: z.string().uuid('يرجى اختيار معمل صالح').optional().nullable(),
    instructions: z.string().max(2000, 'الملاحظات يجب ألا تتجاوز 2000 حرف').optional().nullable(),
    priority: z.enum(['Normal', 'Urgent']).default('Normal'),
    deliveryType: z.enum(['Final', 'TryIn']).optional().nullable(),
    needsDesignReview: z.boolean().default(false),
    technicianStatus: z.enum(['Pending', 'Approved', 'Rejected', 'NeedDetails', 'PMMA_First']).optional().nullable(),
    comments: z.array(z.object({
        id: z.string(),
        text: z.string(),
        userId: z.union([z.string().uuid(), z.literal('system'), z.literal('System')]),
        userName: z.string(),
        createdAt: z.string()
    })).default([]),
    representativeId: z.string().uuid('يرجى اختيار مندوب صالح').optional().nullable(),
    isRegistered: z.boolean().default(false),
    workflowType: z.enum(['full', 'split']).optional().nullable(),
    designerId: z.string().uuid('يرجى اختيار مصمم صالح').optional().nullable(),
    designStatus: z.enum(['pending', 'accepted', 'in_progress', 'waiting_approval', 'completed', 'returned']).optional().nullable(),
    designPrice: z.number().min(0, 'سعر التصميم لا يمكن أن يكون أقل من صفر').optional().nullable(),
    actualDeliveryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'تاريخ التسليم الفعلي غير صحيح').optional().nullable(),
    feedback: z.object({
        rating: z.number().min(1).max(5),
        issues: z.array(z.string()),
        rootCause: z.enum(['Lab', 'Doctor', 'Scan', 'Communication']).optional(),
        notes: z.string().optional(),
        createdAt: z.string()
    }).optional().nullable(),
    isRedo: z.boolean().default(false),
    originalOrderId: z.string().uuid().optional().nullable()
});

export const OrderCreateSchema = OrderSchema.omit({ id: true });
export const OrderUpdateSchema = OrderSchema.partial().extend({
    id: z.string().uuid()
});

// Transaction Validation Schemas
export const TransactionSchema = z.object({
    id: z.string().uuid().optional(),
    type: z.enum(['income', 'expense']),
    amount: z.number().min(0.01, 'المبلغ يجب أن يكون أكبر من صفر'),
    category: z.string().min(1, 'التصنيف مطلوب').max(100, 'التصنيف طويل جداً'),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'التاريخ غير صحيح'),
    description: z.string().min(1, 'الوصف مطلوب').max(500, 'الوصف طويل جداً'),
    entityId: z.string().uuid().optional().nullable(),
    entityType: z.enum(['doctor', 'supplier', 'general', 'designer', 'representative']).optional().nullable(),
    isRegistered: z.boolean().default(false),
    status: z.enum(['pending', 'approved', 'rejected', 'settled']).optional().default('pending')
});

export const TransactionCreateSchema = TransactionSchema.omit({ id: true });
export const TransactionUpdateSchema = TransactionSchema.partial().extend({
    id: z.string().uuid()
});

// Supplier Validation Schemas
export const SupplierSchema = z.object({
    id: z.string().uuid().optional(),
    name: z.string().min(2, 'اسم المورد يجب أن يكون من حرفين على الأقل').max(200, 'اسم المورد طويل جداً'),
    supplierCode: z.string().max(20, 'كود المورد طويل جداً').optional().nullable(),
    username: z.string().min(3, 'اسم المستخدم يجب أن يكون من 3 أحرف على الأقل').max(50).optional().nullable(),
    phone: z.string().min(8, 'رقم الهاتف يجب أن يكون من 8 أرقام على الأقل').max(20, 'رقم الهاتف طويل جداً'),
    isActive: z.boolean().optional(),
    customPrices: z.record(z.string(), z.number().min(0)).optional().nullable(),
    millingPrices: z.record(z.string(), z.number().min(0)).optional().nullable(),
    redoCostPercentage: z.number().min(0, 'النسبة لا يمكن أن تكون أقل من صفر').max(100, 'النسبة لا يمكن أن تتجاوز 100').optional().nullable()
});

export const SupplierCreateSchema = SupplierSchema;
export const SupplierUpdateSchema = SupplierSchema.partial().extend({
    id: z.string().uuid()
});

// Service Validation Schemas
export const ServiceSchema = z.object({
    id: z.string().uuid().optional(),
    name: z.string().min(1, 'اسم الخدمة مطلوب').max(200, 'اسم الخدمة طويل جداً'),
    sellingPrice: z.number().min(0, 'سعر البيع لا يمكن أن يكون أقل من صفر'),
    costPrice: z.number().min(0, 'سعر التكلفة لا يمكن أن يكون أقل من صفر'),
    millingPrice: z.number().min(0, 'سعر الخراطة لا يمكن أن يكون أقل من صفر').optional().nullable(),
    designerPrice: z.number().min(0, 'سعر المصمم لا يمكن أن يكون أقل من صفر').optional().nullable()
});

export const ServiceCreateSchema = ServiceSchema;
export const ServiceUpdateSchema = ServiceSchema.partial().extend({
    id: z.string().uuid()
});


// Helper function to format validation errors
export function formatValidationError(error: z.ZodError | any): string {
    if (error?.errors && Array.isArray(error.errors) && error.errors.length > 0) {
        return error.errors.map((err: any) => err.message).join(' ، ');
    }
    if (error?.message) {
        return error.message;
    }
    return 'خطأ في التحقق من صحة البيانات';
}
