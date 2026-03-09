/* eslint-disable @typescript-eslint/no-explicit-any */
import { z } from 'zod';

// User Validation Schemas
export const UserSchema = z.object({
    id: z.string().uuid().optional(),
    username: z.string().min(3).max(50).regex(/^[a-zA-Z0-9_]+$/, 'اسم المستخدم يجب أن يحتوي على حروف وأرقام فقط'),
    email: z.string().email('البريد الإلكتروني غير صحيح').min(5).max(255),
    password: z.string().min(6, 'كلمة المرور يجب أن تكون 6 أحرف على الأقل')
        .optional(), // Optional for updates
    role: z.enum(['admin', 'lab', 'representative', 'accountant', 'designer', 'doctor']),
    name: z.string().min(2).max(200),
    entityId: z.string().uuid().optional().nullable(),
    baseSalary: z.number().min(0).optional().nullable(),
    unitRate: z.number().min(0).optional().nullable(),
    auth_id: z.string().uuid().optional()
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
    name: z.string().min(2).max(200),
    phone: z.string().min(3).max(20).regex(/^[0-9+\-\s()]+$/, 'رقم الهاتف غير صحيح'),
    phone2: z.union([z.string().min(8).max(20).regex(/^[0-9+\-\s()]+$/), z.literal('')]).optional().nullable(),
    address: z.string().min(5).max(500),
    doctorCode: z.string().min(1).max(20).regex(/^[a-zA-Z0-9\-_]+$/, 'كود الطبيب يجب أن يحتوي على حروف إنجليزية وأرقام فقط'),
    representativeName: z.string().max(200).optional().nullable().or(z.literal('')),
    representativeId: z.union([z.string().uuid(), z.literal('')]).optional().nullable()
});

export const DoctorCreateSchema = DoctorSchema;
export const DoctorUpdateSchema = DoctorSchema.partial().extend({
    id: z.string().uuid()
});

// Order Validation Schemas
export const OrderItemSchema = z.object({
    serviceType: z.string().min(1).max(200),
    teethNumbers: z.array(z.string()).min(1),
    price: z.number().min(0),
    shade: z.string().optional()
});

export const OrderSchema = z.object({
    id: z.string().uuid().optional(),
    caseId: z.string().min(1).max(50),
    doctorId: z.string().uuid(),
    patientName: z.string().min(2).max(200),
    items: z.array(OrderItemSchema).min(1, 'يجب إضافة عنصر واحد على الأقل'),
    discount: z.number().min(0),
    totalPrice: z.number().min(0),
    shade: z.string().max(50).optional().nullable(),
    status: z.enum(['Pending', 'In Progress', 'Completed', 'Delivered', 'New Case', 'Under Design', 'Waiting Dr Approval', 'Under Production', 'Try In', 'Try In Approved', 'Ready', 'Returned for Adjustments', 'Rejected', 'Cancelled', 'Pending Review']),
    isUrgent: z.boolean().optional(),
    deliveryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'تاريخ غير صحيح'),
    cost: z.number().min(0),
    stlUrl: z.string().url().optional().nullable(),
    supplierId: z.string().uuid().optional().nullable(),
    instructions: z.string().max(2000).optional().nullable(),
    priority: z.enum(['Normal', 'Urgent']).default('Normal'),
    deliveryType: z.enum(['Final', 'TryIn']).optional().nullable(),
    needsDesignReview: z.boolean().default(false),
    technicianStatus: z.enum(['Pending', 'Approved', 'Rejected', 'NeedDetails', 'PMMA_First']).optional().nullable(),
    comments: z.array(z.object({
        id: z.string(),
        text: z.string(),
        userId: z.string().uuid(),
        userName: z.string(),
        createdAt: z.string()
    })).default([]),
    representativeId: z.string().uuid().optional().nullable(),
    isRegistered: z.boolean().default(false),
    workflowType: z.enum(['full', 'split']).optional().nullable(),
    designerId: z.string().uuid().optional().nullable(),
    designStatus: z.enum(['pending', 'accepted', 'in_progress', 'waiting_approval', 'completed', 'returned']).optional().nullable(),
    designPrice: z.number().min(0).optional().nullable(),
    actualDeliveryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
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
    category: z.string().min(1).max(100),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'تاريخ غير صحيح'),
    description: z.string().min(1).max(500),
    entityId: z.string().uuid().optional().nullable(),
    entityType: z.enum(['doctor', 'supplier', 'general', 'designer', 'representative']).optional().nullable(),
    isRegistered: z.boolean().default(false),
    status: z.enum(['pending', 'approved', 'rejected']).optional().default('pending')
});

export const TransactionCreateSchema = TransactionSchema.omit({ id: true });
export const TransactionUpdateSchema = TransactionSchema.partial().extend({
    id: z.string().uuid()
});

// Supplier Validation Schemas
export const SupplierSchema = z.object({
    id: z.string().uuid().optional(),
    name: z.string().min(2).max(200),
    supplierCode: z.string().max(20).optional().nullable(),
    username: z.string().min(3).max(50).optional().nullable(),
    phone: z.string().min(8).max(20),
    customPrices: z.record(z.string(), z.number().min(0)).optional().nullable(),
    millingPrices: z.record(z.string(), z.number().min(0)).optional().nullable(),
    redoCostPercentage: z.number().min(0).max(100).optional().nullable()
});

export const SupplierCreateSchema = SupplierSchema;
export const SupplierUpdateSchema = SupplierSchema.partial().extend({
    id: z.string().uuid()
});

// Service Validation Schemas
export const ServiceSchema = z.object({
    id: z.string().uuid().optional(),
    name: z.string().min(1).max(200),
    sellingPrice: z.number().min(0),
    costPrice: z.number().min(0)
});

export const ServiceCreateSchema = ServiceSchema;
export const ServiceUpdateSchema = ServiceSchema.partial().extend({
    id: z.string().uuid()
});

// Helper function to format validation errors
export function formatValidationError(error: z.ZodError | any): string {
    if (error?.errors && Array.isArray(error.errors) && error.errors.length > 0) {
        const firstError = error.errors[0];
        return firstError?.message || 'خطأ في التحقق من صحة البيانات';
    }
    if (error?.message) {
        return error.message;
    }
    return 'خطأ في التحقق من صحة البيانات';
}
