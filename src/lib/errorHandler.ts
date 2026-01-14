// Centralized Error Handling
export class AppError extends Error {
    public code?: string;
    public statusCode?: number;
    public userMessage?: string;

    constructor(
        message: string,
        code?: string,
        statusCode?: number,
        userMessage?: string
    ) {
        super(message);
        this.code = code;
        this.statusCode = statusCode;
        this.userMessage = userMessage;
        this.name = 'AppError';
    }
}

export class ValidationError extends AppError {
    constructor(message: string, userMessage?: string) {
        super(message, 'VALIDATION_ERROR', 400, userMessage || message);
        this.name = 'ValidationError';
    }
}

export class AuthError extends AppError {
    constructor(message: string, userMessage?: string) {
        super(message, 'AUTH_ERROR', 401, userMessage || 'غير مصرح لك بالوصول');
        this.name = 'AuthError';
    }
}

export class NotFoundError extends AppError {
    constructor(message: string, userMessage?: string) {
        super(message, 'NOT_FOUND', 404, userMessage || 'البيانات غير موجودة');
        this.name = 'NotFoundError';
    }
}

export class DatabaseError extends AppError {
    constructor(message: string, userMessage?: string) {
        super(message, 'DATABASE_ERROR', 500, userMessage || 'حدث خطأ في قاعدة البيانات');
        this.name = 'DatabaseError';
    }
}

// Error Handler Service
export class ErrorHandler {
    private static logError(error: Error, context?: string) {
        // In production, send to logging service (e.g., Sentry, LogRocket)
        // For now, only log non-sensitive errors
        if (import.meta.env.DEV) {
            console.error(`[${context || 'ERROR'}]`, {
                message: error.message,
                name: error.name,
                stack: error.stack
            });
        } else {
            // Production: Log to external service without sensitive data
            // Example: logger.error({ message: error.message, context })
        }
    }

    static handle(error: unknown, context?: string): AppError {
        // Convert unknown error to AppError
        if (error instanceof AppError) {
            this.logError(error, context);
            return error;
        }

        if (error instanceof Error) {
            // Check for common error patterns
            if (error.message.includes('JWT') || error.message.includes('token')) {
                const authError = new AuthError(error.message, 'انتهت صلاحية الجلسة، يرجى تسجيل الدخول مرة أخرى');
                this.logError(authError, context);
                return authError;
            }

            if (error.message.includes('not found') || error.message.includes('does not exist')) {
                const notFoundError = new NotFoundError(error.message);
                this.logError(notFoundError, context);
                return notFoundError;
            }

            // RLS / Permission errors
            if (error.message.includes('row-level security') ||
                error.message.includes('42501') ||
                error.message.includes('permission denied') ||
                error.message.includes('new row violates row-level security')) {
                const authError = new AuthError(error.message, 'غير مصرح لك بهذا الإجراء');
                this.logError(authError, context);
                return authError;
            }

            // Database errors
            if (error.message.includes('violates') || error.message.includes('constraint')) {
                const dbError = new DatabaseError(error.message, 'بيانات غير صحيحة أو مكررة');
                this.logError(dbError, context);
                return dbError;
            }

            // Generic error
            const appError = new AppError(error.message, 'UNKNOWN_ERROR', 500, 'حدث خطأ غير متوقع');
            this.logError(appError, context);
            return appError;
        }

        // Unknown error type
        const unknownError = new AppError(
            'An unknown error occurred',
            'UNKNOWN_ERROR',
            500,
            'حدث خطأ غير متوقع'
        );
        this.logError(unknownError, context);
        return unknownError;
    }

    static getUserMessage(error: unknown): string {
        const appError = this.handle(error);
        return appError.userMessage || appError.message || 'حدث خطأ غير متوقع';
    }
}
